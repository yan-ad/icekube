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
