# Multi-platform cluster access

## Phase 1: guided kubeconfig import

Iceon's Catalog discovery is provider-neutral, not GKE-specific. It reads only
`~/.kube/config` on Catalog load/Refresh. **Add config** can import any explicitly
selected kubeconfig elsewhere. There is no `KUBECONFIG` merge, directory scan,
cloud-account enumeration, Docker discovery, SSH, or background file watch.
Explicitly imported files outside the default path must be reimported to reconcile
changed context metadata; connections reread the selected source.

Add config has a compact native file-drop area, an inline Choose File action,
and an optional disclosure containing a searchable **Platform guidance** selector. Selection changes
instructions only, not the import request, credentials, context identity, or
connection behavior. Every named context in the selected file is imported. No
provider is inferred from a context name or endpoint. Generic Kubernetes remains
the default because renamed contexts and custom domains are valid.

Rust `catalog.rs` owns bounded metadata import, canonical source identity,
provenance, colors and pins. `connection/config.rs` selects exactly one context
and prepares HTTPS/CA and credential references; `connection/auth.rs` resolves
credentials on connection only. Credentials, server addresses, helper args/env
and raw kubeconfigs are not persisted in Catalog or sent as Catalog metadata.

Use only trusted kubeconfigs. Import never executes helpers or contacts a cluster,
but opening a workspace initiates the existing connection lifecycle, which may
run the selected non-interactive exec helper. Iceon does not install helpers or
perform interactive provider login. ExecCredential v1 and v1beta1 are supported;
legacy cached OIDC/GCP/Azure credentials do not imply refresh/login support.
Configured `proxy-url`, HTTP and insecure TLS bypass remain rejected. A Rancher
HTTPS server URL containing `/k8s/clusters/...` is not a `proxy-url` tunnel.

### Platform matrix

These are acquisition/authentication paths, not live-provider certification.
Console/API documentation can change independently of Iceon. Documentation
reviewed 2026-10-30. No provider SDK or upstream source was added.

| Platform | Prepare outside Iceon | Kubernetes access / special treatment | Account discovery phase |
| --- | --- | --- | --- |
| GKE | Console/gcloud kubeconfig | Installed gke-gcloud-auth-plugin for exec configs | Future adapter |
| DOKS | Control panel or doctl kubeconfig | Returned token/certificate/exec credential; management token is separate | Token adapter, first batch |
| LKE | Akamai Cloud Manager kubeconfig | Returned cluster credentials; Linode API PAT/OAuth, **not EdgeGrid** | Token adapter, first batch |
| VKE | Vultr console kubeconfig | Returned cluster credentials; separate Vultr API key | Token adapter, first batch |
| OKE | OCI Access Cluster/create-kubeconfig | OCI CLI exec + IAM, short-lived token, existing private-network route | OCI signing/CLI adapter |
| IBM Cloud Kubernetes | ibmcloud ks cluster config | IAM login/helper and token expiry; endpoint scope | IAM adapter |
| Alibaba ACK | ACK console kubeconfig | RAM controls acquisition; cluster certificate/helper depends on exported config | Signed RAM adapter |
| Tencent TKE | TKE console kubeconfig | CAM controls acquisition; per-identity cluster certificate | Signed CAM adapter |
| Scaleway Kapsule | Console kubeconfig | Project/region, supplied cluster credentials, rotation | Token adapter, first batch |
| OVHcloud | Public Cloud project kubeconfig | API application/consumer keys are separate from cluster credentials | Signed OVH adapter |
| Civo | Dashboard or Civo CLI kubeconfig | Region, cluster ready before kubeconfig available | Token adapter, first batch |
| Hetzner + K3s | Administrator-provided local kubeconfig | Self-managed, reachable server/TLS, no universal Hetzner cluster API | Explicit inventory/SSH design, not automatic |
| OpenShift | oc login, then local kubeconfig | OAuth login external; RBAC/SCC server-enforced | Separate OAuth integration, no generic inventory API |
| Rancher | Download downstream kubeconfig | Separate proxy/direct contexts, existing HTTPS auth path | Explicit Rancher instance + API adapter |
| RKE2 | Authorized local copy of rke2.yaml | Admin credentials, reachable endpoint/certificate | Explicit import; no universal cloud API |
| K3s | Authorized local copy of k3s.yaml | Admin credentials, copied certificate rotation | Explicit import; no universal cloud API |
| MicroK8s | microk8s config export | Not a node-join token, reachable local endpoint | Optional explicit CLI workflow |
| kind | Existing/exported kubeconfig | Container runtime and host-reachable endpoint | Optional explicit CLI workflow |
| minikube | Started profile and kubeconfig | Driver network, referenced certificates, stopped/stale profile | Optional explicit CLI workflow |

### Evidence and acceptance

This extends the existing Catalog import workflow referenced against Freelens
v1.10.3-533, commit `cd07118f843c4a69f937a319a37a7c12ef2c92d8`. The local
reference commit was checked before this change. The platform guide is new Iceon
presentation, not ported Freelens code or a parity claim.

- Expected interaction: Add config, optionally choose/search a platform, read the
  acquisition/access caveats, choose a trusted file, import its contexts.
- UI: default generic guidance, platform-specific guidance, picker pending/cancel,
  import pending/error/success, Escape dismissal/focus return. Catalog retains its
  existing loading, empty, stale/error states and columns.
- Rust acceptance: `connection/platform_tests.rs` checks 22 synthetic context/auth
  variants through default discovery and explicit import/preparation, source
  identity, pins/colors, redaction, unselected helper/file isolation, Rancher path
  preservation and rejection of insecure transport. Preparation is not successful
  authentication or a live provider test. Existing `auth_tests.rs` and renewal
  tests cover the bounded helper lifecycle with fixtures.
- Browser acceptance still needed: every guidance choice, unchanged path-only IPC,
  keyboard dismissal/focus return, pending/error handling and narrow/theme states.
  The attempted Playwright test timed out on its selector locator and was removed;
  further Playwright runs were skipped at the user's request. Build/typecheck does
  not establish runtime accessibility or responsive behavior.
- No real credentials, clusters or provider CLIs may be used by these tests.

`bun test ./tools/tests` covers dropped-path validation, scale-aware hit testing,
pending/disposed listener cleanup and StrictMode rendering of the actual dialog
through help/picker pending/cancel/reopen transitions. The reported hook-count
error was not reproduced in this fresh-render test; its runtime component stack
is still needed if it persists after restarting a development session.

## Phase 2: cloud-account discovery (not implemented)

Build explicit adapters, not a provider-name dropdown that pretends to enumerate
accounts. First batch: DOKS, LKE, VKE, Scaleway and Civo. Subsequent batches cover
OCI/IBM, signed ACK/TKE/OVH requests, Rancher inventory and separate OAuth/local
workflows. Pin API versions/OpenAPI revisions before implementing each adapter.

Rust must own:

1. A read-only provider capability contract: credential kind, required scopes,
   region/project/compartment filters, list-cluster pagination and kubeconfig
   retrieval. Never infer clusters from Hetzner servers or local container lists.
2. Secret acquisition/storage design before persistent accounts ship. Keep cloud
   management credentials separate from Kubernetes credentials, out of SQLite
   metadata, logs, renderer events and localStorage. An ephemeral credential flow
   must clearly state retention and still avoid logging IPC payloads.
3. Fixed/validated HTTPS management endpoints, TLS verification, no redirects
   carrying credentials, request deadlines, response/page bounds, rate-limit
   handling and cancellation on dialog disposal/app shutdown. Rancher custom hosts
   need explicit origin selection and separate validation, not arbitrary fetch IPC.
4. Account-scoped generation/request IDs so stale list/download replies cannot
   populate a different account/region or reopen a closed dialog. Report partial,
   denied, expired, empty, provisioning and unavailable distinctly.
5. Explicit cluster selection and confirmation before credential download/import.
   Store any selected kubeconfig through private atomic Rust-managed files with
   rotation/removal semantics, not as Catalog JSON or frontend-generated files.
   Download/import is not connection; no automatic cloud mutations.
6. Synthetic transport tests for auth denial, expiry, pagination, malicious URLs,
   oversized/base64-invalid kubeconfigs, partial enumeration, cancellation,
   credential redaction and cleanup. Live account validation is separately approved.

No new CSP, opener, shell, filesystem or remote-origin capabilities are needed
for phase 1. Phase 2 must not weaken them to work around adapter failures.

## Official references

- [Kubernetes kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [Exec credential plugins](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins)
- [DOKS API](https://docs.digitalocean.com/reference/api/reference/kubernetes/)
- [LKE cluster list](https://techdocs.akamai.com/linode-api/reference/get-lke-clusters)
- [LKE kubeconfig](https://techdocs.akamai.com/linode-api/reference/get-lke-cluster-kubeconfig)
- [Vultr API](https://www.vultr.com/api/)
- [OCI kubeconfig](https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengdownloadkubeconfigfile.htm)
- [IBM access](https://cloud.ibm.com/docs/containers?topic=containers-access_cluster)
- [ACK kubeconfig API](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/developer-reference/api-cs-2015-12-15-describeclusteruserkubeconfig)
- [TKE kubeconfig API](https://www.tencentcloud.com/document/api/457/38510)
- [Scaleway Kubernetes API](https://www.scaleway.com/en/developers/api/kubernetes/)
- [OVHcloud Kubernetes guides](https://help.ovhcloud.com/csm/en-public-cloud-kubernetes?id=kb_browse_cat&kb_id=574a8325551974502d4c6e78b74219c8&kb_category=548f7c961d1874502d4c6e78b74219f0)
- [Civo API](https://www.civo.com/api/kubernetes)
- [Rancher cluster access](https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/manage-clusters/access-clusters/use-kubectl-and-kubeconfig)
- [K3s cluster access](https://docs.k3s.io/cluster-access)
- [RKE2 cluster access](https://docs.rke2.io/cluster_access)
- [MicroK8s commands](https://microk8s.io/docs/command-reference)
- [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [minikube access](https://minikube.sigs.k8s.io/docs/handbook/kubectl/)
- [OpenShift CLI](https://docs.redhat.com/en/documentation/openshift_dedicated/4/html/cli_tools/openshift-cli-oc)
