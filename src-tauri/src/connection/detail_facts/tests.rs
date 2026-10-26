use super::*;
use serde_json::json;

#[test]
fn every_kind_has_explicit_safe_facts_or_sensitive_empty() {
    let source = include_str!("../../connection.rs");
    let variants = source
        .split("pub enum ResourceKind {")
        .nth(1)
        .unwrap()
        .split('}')
        .next()
        .unwrap();
    for variant in variants
        .lines()
        .map(str::trim)
        .map(|s| s.trim_end_matches(','))
        .filter(|s| !s.is_empty())
    {
        let wire = format!("{}{}", variant[..1].to_lowercase(), &variant[1..]);
        let kind: ResourceKind = serde_json::from_value(json!(wire)).unwrap();
        let value = json!({"metadata":{"labels":{"password":"PRIVATE"},"annotations":{"token":"PRIVATE"}},"data":{"PRIVATE":"PRIVATE"},"stringData":{"PRIVATE":"PRIVATE"},"status":{"message":"PRIVATE"},"spec":{"password":"PRIVATE"}});
        let sections = project(kind, &value);
        assert_eq!(
            sections.is_empty(),
            matches!(kind, ResourceKind::Secrets | ResourceKind::ConfigMaps),
            "{kind:?}"
        );
        let serialized = serde_json::to_string(&sections).unwrap();
        assert!(!serialized.contains("PRIVATE"), "{kind:?}");
        assert!(serialized.len() <= MAX_TOTAL);
    }
}

#[test]
fn kind_specific_values_are_not_generic_inventory_columns() {
    for (kind, object, expected) in [
        (
            ResourceKind::Nodes,
            json!({"status":{"capacity":{"cpu":"8"},"nodeInfo":{"kernelVersion":"6.6"}}}),
            "6.6",
        ),
        (
            ResourceKind::DaemonSets,
            json!({"status":{"desiredNumberScheduled":7}}),
            "7",
        ),
        (
            ResourceKind::StatefulSets,
            json!({"spec":{"serviceName":"stable-dns"}}),
            "stable-dns",
        ),
        (
            ResourceKind::Deployments,
            json!({"spec":{"strategy":{"type":"RollingUpdate"}}}),
            "RollingUpdate",
        ),
        (
            ResourceKind::Services,
            json!({"spec":{"ports":[{"port":8080,"targetPort":"http"}]}}),
            "http",
        ),
        (
            ResourceKind::Ingresses,
            json!({"spec":{"tls":[{"hosts":["tls.example.test"],"secretName":"PRIVATE"}]}}),
            "tls.example.test",
        ),
        (
            ResourceKind::Roles,
            json!({"rules":[{"verbs":["get"],"resources":["pods"]}]}),
            "pods",
        ),
        (
            ResourceKind::CustomResourceDefinitions,
            json!({"spec":{"versions":[{"name":"v1","served":false,"storage":true}]}}),
            "false",
        ),
        (
            ResourceKind::PersistentVolumes,
            json!({"spec":{"capacity":{"storage":"50Gi"},"csi":{"nodePublishSecretRef":{"name":"PRIVATE"}}}}),
            "50Gi",
        ),
    ] {
        let encoded = serde_json::to_string(&project(kind, &object)).unwrap();
        assert!(encoded.contains(expected), "{kind:?}");
        assert!(!encoded.contains("PRIVATE"));
    }
}

#[test]
fn values_and_collections_are_bounded_without_raw_serialization() {
    let invalid = [
        "x".repeat(1025),
        "token\nPRIVATE".into(),
        "\u{202e}PRIVATE".into(),
    ];
    for text in invalid {
        let value = json!({"status":{"nodeInfo":{"kernelVersion":text}}});
        let encoded = serde_json::to_string(&project(ResourceKind::Nodes, &value)).unwrap();
        assert!(!encoded.contains("PRIVATE"));
        assert!(!encoded.contains(&"x".repeat(1025)));
    }
    let value = json!({"rules":(0..100).map(|_| json!({"verbs":vec!["\\".repeat(1024);100],"resources":vec!["r".repeat(1024);100]})).collect::<Vec<_>>()});
    let sections = project(ResourceKind::Roles, &value);
    assert!(sections.len() <= MAX_SECTIONS);
    assert!(
        sections
            .iter()
            .all(|s| s.facts.len() <= MAX_FACTS
                && s.facts.iter().all(|f| f.value.len() <= MAX_VALUE))
    );
    assert!(serde_json::to_vec(&sections).unwrap().len() <= MAX_TOTAL);
    let malformed =
        json!({"spec":{"parallelism":{"password":"PRIVATE"},"completions":["PRIVATE"]}});
    assert!(
        !serde_json::to_string(&project(ResourceKind::Jobs, &malformed))
            .unwrap()
            .contains("PRIVATE")
    );
}

#[test]
fn node_condition_facts_never_contain_messages() {
    let value = json!({"status":{"conditions":[{"type":"Ready","status":"False","reason":"KubeletNotReady","message":"PRIVATE"}]}});
    let encoded = serde_json::to_string(&project(ResourceKind::Nodes, &value)).unwrap();
    assert!(encoded.contains("KubeletNotReady"));
    assert!(!encoded.contains("PRIVATE"));
}

fn assert_partial(sections: &[DetailSection]) {
    let coverage = sections.last().expect("coverage section");
    assert_eq!(coverage.title, "Coverage");
    assert_eq!(coverage.facts.len(), 1);
    assert_eq!(coverage.facts[0].label, "Coverage");
    assert!(coverage.facts[0].value.starts_with("Partial:"));
    assert!(sections.len() <= MAX_SECTIONS);
    assert!(sections.iter().all(|s| s.facts.len() <= MAX_FACTS));
    assert!(serde_json::to_vec(sections).unwrap().len() <= MAX_TOTAL);
}

#[test]
fn rbac_combined_arrays_disclose_displaced_resource_names() {
    let rule = json!({"verbs":vec!["get";12],"apiGroups":vec!["apps";12],
        "resources":vec!["deployments";12],"resourceNames":vec!["named-target";12]});
    let sections = project(ResourceKind::Roles, &json!({"rules":[rule]}));
    assert_partial(&sections);
    assert!(
        !serde_json::to_string(&sections)
            .unwrap()
            .contains("named-target")
    );
}

#[test]
fn empty_api_groups_are_core_not_missing_or_arbitrary_empty_values() {
    let sections = project(
        ResourceKind::Roles,
        &json!({"rules":[{"apiGroups":[""],"verbs":["get"]}]}),
    );
    assert!(
        sections
            .iter()
            .flat_map(|s| &s.facts)
            .any(|f| f.label == "API group" && f.value == "(core)")
    );
    assert!(!sections.iter().any(|s| s.title == "Coverage"));
    let sections = project(
        ResourceKind::RoleBindings,
        &json!({"subjects":[{"apiGroup":"","name":"user"}]}),
    );
    assert!(
        sections
            .iter()
            .flat_map(|s| &s.facts)
            .any(|f| f.label.ends_with("API group") && f.value == "(core)")
    );
    let sections = project(ResourceKind::Roles, &json!({"rules":[{"resources":[""]}]}));
    assert_partial(&sections);
    assert!(!serde_json::to_string(&sections).unwrap().contains("(core)"));
}

#[test]
fn outer_collection_limits_always_report_partial() {
    for (kind, value) in [
        (
            ResourceKind::Endpoints,
            json!({"subsets":vec![json!({"addresses":[{"ip":"127.0.0.1"}]});4]}),
        ),
        (
            ResourceKind::EndpointSlices,
            json!({"endpoints":vec![json!({"addresses":["127.0.0.1"]});7]}),
        ),
        (
            ResourceKind::Ingresses,
            json!({"spec":{"rules":vec![json!({"http":{"paths":[{"path":"/"}]}});5]}}),
        ),
        (
            ResourceKind::Ingresses,
            json!({"spec":{"tls":vec![json!({"hosts":["example.test"]});5]}}),
        ),
        (
            ResourceKind::Roles,
            json!({"rules":vec![json!({"verbs":["get"]});9]}),
        ),
    ] {
        assert_partial(&project(kind, &value));
    }
}

#[test]
fn byte_budget_and_section_budget_reserve_final_coverage() {
    let mut facts = Facts::default();
    for i in 0..MAX_SECTIONS + 1 {
        facts.push(
            &format!("Section {i}"),
            vec![
                DetailFact {
                    label: "Value".into(),
                    value: "\\".repeat(MAX_VALUE)
                };
                MAX_FACTS
            ],
        );
    }
    assert_partial(&facts.finish());
    let mut facts = Facts::default();
    for _ in 0..2 {
        facts.push(
            "Large section",
            vec![
                DetailFact {
                    label: "Value".into(),
                    value: "é".repeat(MAX_VALUE / 2)
                };
                MAX_FACTS
            ],
        );
    }
    let sections = facts.finish();
    assert_partial(&sections);
    assert!(
        sections
            .iter()
            .filter(|s| s.title != "Coverage")
            .map(|s| s.facts.len())
            .sum::<usize>()
            < 2 * MAX_FACTS
    );
    let mut facts = Facts::default();
    for _ in 0..MAX_SECTIONS + 1 {
        facts.push(
            "Section",
            vec![DetailFact {
                label: "Value".into(),
                value: "present".into(),
            }],
        );
    }
    assert_partial(&facts.finish());
    let mut facts = Facts::default();
    for _ in 0..MAX_SECTIONS {
        facts.push(
            "Section",
            vec![DetailFact {
                label: "Value".into(),
                value: "present".into(),
            }],
        );
    }
    // Invalid input after filling all section slots must still get a coverage slot.
    facts.fields(
        "Rejected",
        &json!({"value":"\u{2067}hidden"}),
        &[("Value", "/value")],
    );
    assert_partial(&facts.finish());
}

#[test]
fn invalid_values_are_partial_but_absent_optional_values_are_not() {
    for value in [
        json!("\u{202e}hidden"),
        json!("\u{2069}hidden"),
        json!("é".repeat(513)),
        json!({"unsupported":true}),
    ] {
        assert_partial(&project(
            ResourceKind::Jobs,
            &json!({"spec":{"parallelism":value}}),
        ));
    }
    assert!(
        !project(ResourceKind::Jobs, &json!({}))
            .iter()
            .any(|s| s.title == "Coverage")
    );
}

#[test]
fn sensitive_secret_env_header_and_webhook_ca_sentinels_never_escape() {
    let value = json!({
        "data":{"password":"SECRET_SENTINEL"},"stringData":{"password":"SECRET_SENTINEL"},
        "spec":{"containers":[{"env":[{"value":"ENV_SENTINEL"}],"livenessProbe":{"httpGet":{"httpHeaders":[{"value":"HEADER_SENTINEL"}]}}}]},
        "webhooks":[{"name":"safe.example.test","clientConfig":{"caBundle":"CA_SENTINEL","url":"HEADER_SENTINEL"}}]
    });
    for kind in [
        ResourceKind::Secrets,
        ResourceKind::ConfigMaps,
        ResourceKind::Pods,
        ResourceKind::MutatingWebhookConfigurations,
        ResourceKind::ValidatingWebhookConfigurations,
    ] {
        let encoded = serde_json::to_string(&project(kind, &value)).unwrap();
        for sentinel in [
            "SECRET_SENTINEL",
            "ENV_SENTINEL",
            "HEADER_SENTINEL",
            "CA_SENTINEL",
        ] {
            assert!(!encoded.contains(sentinel), "{kind:?}: {sentinel}");
        }
    }
}
