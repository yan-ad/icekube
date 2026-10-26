use serde::Serialize;

const REPOSITORY_URL: &str = "https://github.com/yan-ad/icekube";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectError {
    OpenFailed,
}

pub fn open_repository_with<E>(
    open: impl FnOnce(&str) -> Result<(), E>,
) -> Result<(), ProjectError> {
    open(REPOSITORY_URL).map_err(|_| ProjectError::OpenFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_the_fixed_https_repository() {
        let mut calls = Vec::new();
        assert_eq!(
            open_repository_with(|url| {
                calls.push(url.to_owned());
                Ok::<_, ()>(())
            }),
            Ok(())
        );
        assert_eq!(calls, ["https://github.com/yan-ad/icekube"]);
        let url = url::Url::parse(REPOSITORY_URL).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(url.username().is_empty());
        assert!(url.password().is_none());
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
    }

    #[test]
    fn opener_failures_do_not_expose_platform_details() {
        let error = open_repository_with(|_| Err("private platform diagnostics")).unwrap_err();
        assert_eq!(serde_json::to_string(&error).unwrap(), "\"openFailed\"");
    }

    #[test]
    fn command_has_no_renderer_url_or_catalog_state() {
        let source = include_str!("lib.rs");
        let signature = source
            .split("async fn project_open_repository(")
            .nth(1)
            .unwrap()
            .split(") ->")
            .next()
            .unwrap();
        assert_eq!(signature, "app: tauri::AppHandle");
        assert!(source.contains("            project_open_repository,"));
    }
}
