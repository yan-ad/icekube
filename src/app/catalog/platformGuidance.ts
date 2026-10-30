type PlatformGroup = "Kubeconfig" | "Managed Kubernetes" | "Enterprise and self-managed" | "Local development";
type PlatformGuidance = { id: string; label: string; group: PlatformGroup; prepare: string; access: string };

// Guidance is presentation only. Kubernetes credentials and helper execution remain Rust-owned.
export const platformGuidance: readonly PlatformGuidance[] = [
  {
    id: "generic", label: "Any Kubernetes cluster", group: "Kubeconfig",
    prepare: "Choose a trusted kubeconfig from your cluster administrator or provider. All named contexts in the file are imported, regardless of platform.",
    access: "Automatic discovery reads only ~/.kube/config on catalog load and Refresh. Use Choose File for configs stored elsewhere. Iceon does not scan directories or read KUBECONFIG.",
  },
  {
    id: "gke", label: "Google Kubernetes Engine (GKE)", group: "Managed Kubernetes",
    prepare: "Use Google Cloud's console or gcloud to configure cluster access, then import the resulting kubeconfig.",
    access: "For exec-based credentials, install and authenticate the gke-gcloud-auth-plugin before opening the workspace. Import does not run it.",
  },
  {
    id: "doks", label: "DigitalOcean Kubernetes (DOKS)", group: "Managed Kubernetes",
    prepare: "Download the cluster kubeconfig from the DigitalOcean control panel, or save it with doctl, then choose that file.",
    access: "DigitalOcean API tokens manage the account; they are not a replacement for kubeconfig credentials. Expired cluster credentials must be renewed through the provider.",
  },
  {
    id: "lke", label: "Akamai / Linode Kubernetes Engine (LKE)", group: "Managed Kubernetes",
    prepare: "Download the cluster kubeconfig from Akamai Cloud Manager, then choose the downloaded YAML file.",
    access: "LKE management uses the Linode API with a personal access token or OAuth, not Akamai EdgeGrid. Iceon imports the kubeconfig, not the management API token.",
  },
  {
    id: "vke", label: "Vultr Kubernetes Engine (VKE)", group: "Managed Kubernetes",
    prepare: "Download the cluster kubeconfig from the Vultr console, then choose that file.",
    access: "A Vultr API key is a management credential, not a Kubernetes credential. Keep the kubeconfig's CA and client credentials intact.",
  },
  {
    id: "oke", label: "Oracle Kubernetes Engine (OKE)", group: "Managed Kubernetes",
    prepare: "Follow Access Cluster in the OCI console to generate a kubeconfig with the OCI CLI, then choose the generated file.",
    access: "OCI exec authentication needs an installed, authenticated OCI CLI and OCI IAM access. Interactive login must happen outside Iceon. Private endpoints require an existing network route.",
  },
  {
    id: "ibm", label: "IBM Cloud Kubernetes Service", group: "Managed Kubernetes",
    prepare: "Authenticate with IBM Cloud and use ibmcloud ks cluster config for your cluster, then import the resulting kubeconfig.",
    access: "Install any IAM credential helper referenced by the file and complete login outside Iceon. IAM tokens can expire; private endpoints require an existing network route.",
  },
  {
    id: "ack", label: "Alibaba Cloud Container Service (ACK)", group: "Managed Kubernetes",
    prepare: "Obtain the cluster kubeconfig from the ACK console using your authorized RAM identity, then choose that file.",
    access: "RAM credentials authorize the management API. Use the Kubernetes credentials in the generated kubeconfig and renew them through ACK when they expire.",
  },
  {
    id: "tke", label: "Tencent Kubernetes Engine (TKE)", group: "Managed Kubernetes",
    prepare: "Obtain the cluster kubeconfig from the TKE console with your authorized CAM identity, then choose that file.",
    access: "Tencent API signing credentials are separate from the kubeconfig's client certificate. Choose an endpoint reachable from this computer.",
  },
  {
    id: "scaleway", label: "Scaleway Kubernetes Kapsule", group: "Managed Kubernetes",
    prepare: "Download the cluster kubeconfig from the Scaleway console for the correct project and region, then choose that file.",
    access: "A Scaleway secret key manages the account; use the credentials supplied in the kubeconfig for cluster access. Download a fresh config after resetting cluster credentials.",
  },
  {
    id: "ovh", label: "OVHcloud Managed Kubernetes", group: "Managed Kubernetes",
    prepare: "Download the kubeconfig from your OVHcloud Public Cloud project's Kubernetes cluster page, then choose that file.",
    access: "OVHcloud application and consumer credentials are management API credentials. The downloaded kubeconfig supplies separate cluster credentials and CA trust.",
  },
  {
    id: "civo", label: "Civo Kubernetes", group: "Managed Kubernetes",
    prepare: "Download the kubeconfig for a ready cluster in the Civo dashboard, or save it using the Civo CLI, then choose that file.",
    access: "Select the correct Civo region. A cluster still being provisioned may not have a kubeconfig yet. Do not paste a Civo API key into the path field.",
  },
  {
    id: "hetzner", label: "Hetzner Cloud + K3s", group: "Enterprise and self-managed",
    prepare: "Obtain a kubeconfig from your K3s administrator using your existing secure transfer process, then choose the local copy.",
    access: "Hetzner server inventory does not identify Kubernetes clusters. Use a reachable API address covered by the server certificate. Iceon does not start SSH tunnels or change networking.",
  },
  {
    id: "openshift", label: "Red Hat OpenShift", group: "Enterprise and self-managed",
    prepare: "Complete oc login outside Iceon, then import its kubeconfig. Prefer a scoped user identity over an administrator config.",
    access: "OpenShift OAuth login is external; tokens can expire. Kubernetes RBAC and Security Context Constraints remain server-enforced. This does not add an OpenShift-specific management UI.",
  },
  {
    id: "rancher", label: "Rancher", group: "Enterprise and self-managed",
    prepare: "Download the downstream cluster kubeconfig from Rancher, then choose that file. Proxy and authorized direct-endpoint contexts remain separate entries.",
    access: "The Rancher HTTPS API proxy path is supported by the kubeconfig connection path. Rancher login, account cluster enumeration, and kubeconfig proxy-url tunnels are not provided here.",
  },
  {
    id: "rke2", label: "RKE2", group: "Enterprise and self-managed",
    prepare: "Obtain an authorized copy of /etc/rancher/rke2/rke2.yaml from your administrator, then choose the local file.",
    access: "The server's loopback address must be replaced with a reachable address covered by its certificate for remote use. This admin config is highly privileged; Iceon does not fetch it over SSH.",
  },
  {
    id: "k3s", label: "K3s", group: "Enterprise and self-managed",
    prepare: "Obtain an authorized copy of /etc/rancher/k3s/k3s.yaml, then choose the local file. Keep copied credentials current when the server rotates certificates.",
    access: "The admin config is highly privileged. For remote access, use a reachable API address covered by the server certificate. Iceon does not read /etc/rancher automatically.",
  },
  {
    id: "microk8s", label: "MicroK8s", group: "Local development",
    prepare: "Export a kubeconfig using microk8s config outside Iceon, save it locally, then choose that file.",
    access: "Use the kubeconfig's API credentials, not a node-join token. Remote access requires a reachable server address and valid CA trust; Iceon does not configure the host network.",
  },
  {
    id: "kind", label: "kind", group: "Local development",
    prepare: "Create or export the kind kubeconfig outside Iceon. Contexts in ~/.kube/config appear on Refresh; choose a separate export explicitly.",
    access: "The container runtime and cluster must be running. An endpoint inside a container network may not be reachable from the desktop. A saved context does not prove the cluster still exists.",
  },
  {
    id: "minikube", label: "minikube", group: "Local development",
    prepare: "Start the required minikube profile outside Iceon. Refresh for contexts in ~/.kube/config, or choose the profile's kubeconfig file.",
    access: "Keep referenced certificate files accessible. Driver-specific networking determines endpoint reachability. Iceon does not start profiles or alter Docker networking.",
  },
];

const groups: PlatformGroup[] = ["Kubeconfig", "Managed Kubernetes", "Enterprise and self-managed", "Local development"];
export const platformOptions = groups.map(title => ({
  type: "section" as const, title,
  options: platformGuidance.filter(platform => platform.group === title).map(({ id, label }) => ({ value: id, label })),
}));
