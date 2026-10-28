use super::{Result, add, read_hint};
use std::path::{Component, Path, PathBuf};

// Extract SDK hints only; this deliberately does not interpret fish programs.
fn words(line: &str) -> Option<Vec<&str>> {
    if line.contains([';', '(', ')', '`', '\\', '|', '&', '<', '>', '\0']) {
        return None;
    }
    let mut rest = line.trim();
    let mut words = Vec::new();
    while !rest.is_empty() && !rest.starts_with('#') {
        if words.len() >= 128 {
            return None;
        }
        let end = if rest.starts_with(['\'', '"']) {
            let quote = rest.chars().next()?;
            let end = rest[1..].find(quote)? + 2;
            if !rest[end..].is_empty() && !rest[end..].starts_with(char::is_whitespace) {
                return None;
            }
            end
        } else {
            rest.find(char::is_whitespace).unwrap_or(rest.len())
        };
        words.push(&rest[..end]);
        rest = rest[end..].trim_start();
    }
    Some(words)
}

fn literal(word: &str, home: &Path) -> Option<PathBuf> {
    let (text, expand_home) = if word.starts_with('\'') {
        (word.strip_prefix('\'')?.strip_suffix('\'')?, false)
    } else if word.starts_with('"') {
        (word.strip_prefix('"')?.strip_suffix('"')?, true)
    } else {
        if word.contains('~') && !word.starts_with("~/") {
            return None;
        }
        (word, true)
    };
    let path = if expand_home && let Some(rest) = text.strip_prefix("$HOME/") {
        home.join(rest.trim_start_matches('/'))
    } else if !word.starts_with(['\'', '"'])
        && let Some(rest) = text.strip_prefix("~/")
    {
        home.join(rest.trim_start_matches('/'))
    } else {
        PathBuf::from(text)
    };
    let text = path.to_str()?;
    (path.is_absolute()
        && !text.chars().any(|c| c.is_control())
        && !text.contains([
            '$', '`', ';', '\\', '|', '&', '<', '>', '*', '?', '{', '}', '[', ']', '\'', '"', '(',
            ')',
        ])
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir)))
    .then_some(path)
}

fn sdk_bin(path: PathBuf) -> Option<PathBuf> {
    path.ends_with("google-cloud-sdk/bin").then_some(path)
}

fn hints(line: &str, home: &Path) -> Option<Vec<PathBuf>> {
    let words = words(line)?;
    let (command, rest) = words.split_first()?;
    if *command == "source" {
        let [word] = rest else { return None };
        let source = literal(word, home)?;
        return source
            .ends_with("google-cloud-sdk/path.fish.inc")
            .then(|| vec![source.parent().unwrap().join("bin")]);
    }
    let mut index = 0;
    match *command {
        "set" => {
            while let Some(flag) = rest.get(index).filter(|word| word.starts_with('-')) {
                let valid = matches!(
                    *flag,
                    "--export" | "--global" | "--universal" | "--append" | "--prepend"
                ) || (flag.starts_with('-')
                    && flag.len() > 1
                    && flag[1..].chars().all(|c| "gxUap".contains(c)));
                if !valid {
                    return None;
                }
                index += 1;
            }
            if !matches!(rest.get(index), Some(&"PATH" | &"fish_user_paths")) {
                return None;
            }
            index += 1;
        }
        "fish_add_path" => {
            while let Some(flag) = rest.get(index).filter(|word| word.starts_with('-')) {
                if !matches!(
                    *flag,
                    "-g" | "-U"
                        | "-P"
                        | "-a"
                        | "-p"
                        | "-m"
                        | "--global"
                        | "--universal"
                        | "--path"
                        | "--append"
                        | "--prepend"
                        | "--move"
                        | "--"
                ) {
                    return None;
                }
                index += 1;
                if *flag == "--" {
                    break;
                }
            }
        }
        _ => return None,
    }
    let mut paths = Vec::new();
    for word in &rest[index..] {
        if matches!(
            *word,
            "$PATH" | "\"$PATH\"" | "$fish_user_paths" | "\"$fish_user_paths\""
        ) {
            continue;
        }
        let path = literal(word, home)?;
        if let Some(path) = sdk_bin(path) {
            paths.push(path);
        }
    }
    Some(paths)
}

fn universal_hints(line: &str) -> Option<Vec<PathBuf>> {
    let mut rest = line.trim().strip_prefix("SETUVAR ")?.trim_start();
    while rest.starts_with("--") {
        let (flag, tail) = rest.split_once(char::is_whitespace)?;
        if !matches!(flag, "--export" | "--path") {
            return None;
        }
        rest = tail.trim_start();
    }
    let encoded = rest.strip_prefix("fish_user_paths:")?;
    let mut chars = encoded.chars();
    let mut decoded = String::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            decoded.push(c);
            continue;
        }
        let digits = match chars.next()? {
            'x' => 2,
            'u' => 4,
            'U' => 8,
            _ => return None,
        };
        let mut code = 0_u32;
        for _ in 0..digits {
            code = code
                .checked_mul(16)?
                .checked_add(chars.next()?.to_digit(16)?)?;
        }
        decoded.push(char::from_u32(code)?);
    }
    Some(
        decoded
            .split('\u{1e}')
            .filter_map(|text| {
                // Universal variables are already expanded; never expand their contents again.
                if text.contains(['\'', '"', '$', '~']) {
                    return None;
                }
                sdk_bin(literal(text, Path::new(""))?)
            })
            .collect(),
    )
}

pub(super) fn discover(
    home: &Path,
    config_home: Option<&Path>,
    directories: &mut Vec<PathBuf>,
    budget: &mut usize,
    stopped: &impl Fn() -> bool,
) -> Result<()> {
    let config = config_home
        .filter(|path| path.is_absolute())
        .map(Path::to_owned)
        .unwrap_or_else(|| home.join(".config"))
        .join("fish");
    let mut paths = vec![config.join("config.fish"), config.join("fish_variables")];
    let snippets = config.join("conf.d");
    if std::fs::symlink_metadata(&snippets).is_ok_and(|metadata| metadata.is_dir())
        && let Ok(entries) = std::fs::read_dir(snippets)
    {
        let mut files = Vec::new();
        let mut count = 0;
        for entry in entries.take(33) {
            if stopped() {
                return Ok(());
            }
            count += 1;
            if let Ok(entry) = entry
                && entry.path().extension().is_some_and(|ext| ext == "fish")
            {
                files.push(entry.path());
            }
        }
        if count <= 32 {
            files.sort();
            paths.extend(files);
        }
    }
    for path in paths {
        if stopped() {
            return Ok(());
        }
        if let Some(contents) = read_hint(&path, budget) {
            for line in contents.lines() {
                if stopped() {
                    return Ok(());
                }
                let found = if path
                    .file_name()
                    .is_some_and(|name| name == "fish_variables")
                {
                    universal_hints(line)
                } else {
                    hints(line, home)
                };
                for directory in found.into_iter().flatten() {
                    add(directories, directory)?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_literal_sdk_declarations() {
        let home = Path::new("/Users/fixture");
        let expected = home.join("Kerjaa/google-cloud-sdk/bin");
        for line in [
            "set -gx PATH \"$HOME/Kerjaa/google-cloud-sdk/bin\" $PATH # cloud SDK",
            "set --global --export PATH ~/Kerjaa/google-cloud-sdk/bin $PATH",
            "set -gx PATH \"$HOME//Kerjaa/google-cloud-sdk/bin\" $PATH",
            "fish_add_path ~//Kerjaa/google-cloud-sdk/bin",
            "set -Ua fish_user_paths '/Users/fixture/Kerjaa/google-cloud-sdk/bin'",
            "fish_add_path --path --append /Users/fixture/Kerjaa/google-cloud-sdk/bin",
            "source \"$HOME/Kerjaa/google-cloud-sdk/path.fish.inc\"",
        ] {
            assert_eq!(hints(line, home), Some(vec![expected.clone()]), "{line}");
        }
        for line in [
            "# fish_add_path /secret/google-cloud-sdk/bin",
            "fish_add_path (/must/notexecute)/google-cloud-sdk/bin",
            "fish_add_path \"$(/must/notexecute)/google-cloud-sdk/bin\"",
            "fish_add_path /secret/google-cloud-sdk/bin; touch /must/notexecute",
            "fish_add_path /secret/../google-cloud-sdk/bin",
            "fish_add_path relative/google-cloud-sdk/bin",
            "fish_add_path '$HOME/Kerjaa/google-cloud-sdk/bin'",
            "fish_add_path \"~/Kerjaa/google-cloud-sdk/bin\"",
            "fish_add_path $SDK/google-cloud-sdk/bin",
            "fish_add_path /secret/*/google-cloud-sdk/bin",
            "fish_add_path \"/secret/google-cloud-sdk/bin\"suffix",
            "fish_add_path --dry-run /secret/google-cloud-sdk/bin",
            "set --erase PATH /secret/google-cloud-sdk/bin",
            "set OTHER /secret/google-cloud-sdk/bin",
            "source /secret/google-cloud-sdk/path.bash.inc",
            "fish_add_path \"/secret/google-cloud-sdk/bin",
        ] {
            assert!(hints(line, home).is_none(), "{line}");
        }
        assert_eq!(hints("fish_add_path /unrelated/bin", home), Some(vec![]));
    }

    #[test]
    fn decodes_only_saved_fish_user_paths_without_expansion() {
        assert_eq!(
            universal_hints(
                r"SETUVAR --export --path fish_user_paths:/opt/other\x1e/Users/fixture/SDK\x20\u00fc\U0001f41f/google\x2dcloud\x2dsdk/bin"
            ),
            Some(vec![PathBuf::from(
                "/Users/fixture/SDK ü🐟/google-cloud-sdk/bin"
            )])
        );
        for line in [
            r"SETUVAR fish_user_paths:/sdk\xZZ/google-cloud-sdk/bin",
            r"SETUVAR fish_user_paths:/sdk\uD800/google-cloud-sdk/bin",
            r"SETUVAR fish_user_paths:/sdk\Uffffffff/google-cloud-sdk/bin",
            r"SETUVAR --unknown fish_user_paths:/sdk/google-cloud-sdk/bin",
            r"SETUVAR OTHER:/sdk/google-cloud-sdk/bin",
        ] {
            assert!(universal_hints(line).is_none(), "{line}");
        }
        for text in [
            "$HOME/sdk/google-cloud-sdk/bin",
            "/sdk/../google-cloud-sdk/bin",
            "/sdk\\x00/google-cloud-sdk/bin",
            "relative/google-cloud-sdk/bin",
            "/sdk/$(touch)/google-cloud-sdk/bin",
        ] {
            assert_eq!(
                universal_hints(&format!("SETUVAR fish_user_paths:{text}")),
                Some(vec![])
            );
        }
    }

    #[test]
    fn discovery_respects_xdg_budget_cancellation_and_snippet_limit() {
        use std::fs;
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let xdg = root.path().join("custom-config");
        let fish = xdg.join("fish");
        fs::create_dir_all(fish.join("conf.d")).unwrap();
        fs::write(
            fish.join("config.fish"),
            "fish_add_path /config/google-cloud-sdk/bin",
        )
        .unwrap();
        fs::write(
            fish.join("fish_variables"),
            r"SETUVAR fish_user_paths:/saved/google\x2dcloud\x2dsdk/bin",
        )
        .unwrap();
        fs::write(
            fish.join("conf.d/a.fish"),
            "fish_add_path /snippet/google-cloud-sdk/bin",
        )
        .unwrap();
        fs::write(
            fish.join("conf.d/ignored.txt"),
            "fish_add_path /ignored/google-cloud-sdk/bin",
        )
        .unwrap();
        let mut dirs = Vec::new();
        let mut budget = super::super::READ_LIMIT;
        discover(&home, Some(&xdg), &mut dirs, &mut budget, &|| true).unwrap();
        assert!(dirs.is_empty());
        assert_eq!(budget, super::super::READ_LIMIT);
        discover(&home, Some(&xdg), &mut dirs, &mut budget, &|| false).unwrap();
        assert_eq!(
            dirs,
            [
                "/config/google-cloud-sdk/bin",
                "/saved/google-cloud-sdk/bin",
                "/snippet/google-cloud-sdk/bin"
            ]
            .map(PathBuf::from)
        );
        assert!(budget < super::super::READ_LIMIT);
        dirs.clear();
        let mut empty_budget = 0;
        discover(&home, Some(&xdg), &mut dirs, &mut empty_budget, &|| false).unwrap();
        assert!(dirs.is_empty());
        fs::remove_file(fish.join("config.fish")).unwrap();
        fs::remove_file(fish.join("fish_variables")).unwrap();
        for i in 0..33 {
            fs::write(
                fish.join(format!("conf.d/{i}.fish")),
                "fish_add_path /overflow/google-cloud-sdk/bin",
            )
            .unwrap();
        }
        budget = super::super::READ_LIMIT;
        discover(&home, Some(&xdg), &mut dirs, &mut budget, &|| false).unwrap();
        assert!(dirs.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn discovery_rejects_symlinked_and_oversized_hint_files() {
        use std::{fs, os::unix::fs::symlink};
        let root = tempfile::tempdir().unwrap();
        let fish = root.path().join(".config/fish");
        fs::create_dir_all(&fish).unwrap();
        let target = root.path().join("hint");
        fs::write(&target, "fish_add_path /linked/google-cloud-sdk/bin").unwrap();
        symlink(&target, fish.join("config.fish")).unwrap();
        fs::write(
            fish.join("fish_variables"),
            "x".repeat(super::super::FILE_LIMIT + 1),
        )
        .unwrap();
        let mut dirs = Vec::new();
        let mut budget = super::super::READ_LIMIT;
        discover(root.path(), None, &mut dirs, &mut budget, &|| false).unwrap();
        assert!(dirs.is_empty());
        assert_eq!(budget, super::super::READ_LIMIT);
    }
}
