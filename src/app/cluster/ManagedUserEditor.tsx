import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { connectionMessage, errorCode, nextReadId, type SessionRequest } from "./api";
import { NamespaceSelector } from "./NamespaceScope";
import { usePermissionChecks } from "./PermissionProvider";
import { useUpdateBlocker } from "../updates/UpdateProvider";
import { applyManagedUser, cancelManagedUsers, planManagedUser, readOnlyTemplate, validManagedUser, validUsersNamespace, type ApplyResponse, type Assignment, type CancelRequest, type ManagedTemplate, type ManagedUser, type Operation, type PlanSummary, type UserPlan } from "./managedUsersApi";

type Props = SessionRequest & { initial: ManagedUser; templates: ManagedTemplate[]; onClose: (changed: boolean) => void };
const label = (t: ManagedTemplate) => t.name.replace(/^template-(?:namespaced|cluster)-resources___/, "");
export function ManagedRuleSummary({ rows }: { rows: PlanSummary[] }) {
  const columns: TableColumn<PlanSummary & { id: string }>[] = [
    { key: "resource", header: "Resource", width: proportional(2), renderCell: row => <Text>{row.resources.join(", ") || "Non-resource URL"}{row.nonResourceURLs.length > 0 ? `: ${row.nonResourceURLs.join(", ")}` : ""}</Text> },
    { key: "group", header: "Group", width: proportional(1), renderCell: row => <Text>{row.apiGroups.map(group => group || "(core)").join(", ") || "None"}</Text> },
    { key: "verbs", header: "Verbs", width: proportional(2), renderCell: row => <Text>{row.verbs.join(", ") || "None"}</Text> },
    { key: "names", header: "Resource names", width: proportional(2), renderCell: row => <Text>{row.resourceNames.join(", ") || "Unrestricted"}</Text> },
    { key: "namespaces", header: "Namespace", width: proportional(2), renderCell: row => <Text>{row.namespaces === null ? "All namespaces / cluster scope" : row.namespaces.join(", ") || "None selected"}</Text> },
  ];
  return rows.length ? <Table aria-label="Exact permission rules" data={rows.map((row, i) => ({ ...row, id: String(i) }))} columns={columns} idKey="id" density="compact" /> : <Text>No rules in this selection.</Text>;
}
function NamespaceMultiSelect({ assignment, index, userNamespace, busy, onChange }: { assignment: Assignment; index: number; userNamespace: string; busy: boolean; onChange: (next: Assignment) => void }) {
  const [manual, setManual] = useState("");
  const [known, setKnown] = useState<string[]>([userNamespace, ...assignment.namespaces]);
  const entered = manual.split(",").map(v => v.trim());
  const valid = entered.length > 0 && entered.every(validUsersNamespace) && new Set(entered).size === entered.length && new Set([...assignment.namespaces, ...entered]).size <= 32;
  const add = (names: string[]) => { const values = [...new Set([...assignment.namespaces, ...names])]; if (values.length <= 32) { setKnown(previous => [...new Set([...previous, ...names])]); onChange({ ...assignment, namespaces: values }); } };
  return <VStack gap={2}>
    <CheckboxInput label={`All namespaces ${index + 1}`} isDisabled={busy} value={assignment.allNamespaces} onChange={allNamespaces => onChange({ ...assignment, allNamespaces, namespaces: [] })} />
    {!assignment.allNamespaces && <>
      <MultiSelector label={`Namespaces ${index + 1}`} isDisabled={busy} hasSearch presentation="adaptive" width="100%" triggerDisplay="labels" value={assignment.namespaces} options={[...new Set([...known, ...assignment.namespaces])]} onChange={namespaces => { if (!busy && namespaces.length <= 32) onChange({ ...assignment, namespaces }); }} />
      {!busy && <NamespaceSelector label={`Add discovered namespace ${index + 1}`} isLabelHidden={false} allowAll={false} value="" onChange={ns => { if (validUsersNamespace(ns)) add([ns]); }} />}
      <HStack gap={2} wrap="wrap" vAlign="end">
        <TextInput label={`Known namespaces ${index + 1}`} isDisabled={busy} description="Comma-separated names, up to 32. Available when discovery is denied." value={manual} onChange={setManual} />
        <Button label={`Add namespaces ${index + 1}`} variant="ghost" isDisabled={busy || !valid} onClick={() => { add(entered); setManual(""); }} />
      </HStack>
    </>}
  </VStack>;
}
export function ManagedUserEditor({ clusterId, sessionId, initial, templates, onClose }: Props) {
  useUpdateBlocker(true, "Managed user editing is open.");
  const [user, setUser] = useState<ManagedUser>(() => structuredClone(initial));
  const [plan, setPlan] = useState<UserPlan | null>(null);
  const [planEpoch, setPlanEpoch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const current = useRef<CancelRequest | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const inFlight = useRef(false);
  const applying = useRef(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const reviewRegion = useRef<HTMLElement>(null);
  const existing = initial.uid !== null;
  const createCheck = { kind: "serviceAccounts" as const, action: existing ? "update" as const : "create" as const, namespace: user.namespace, name: existing ? user.name : null };
  const deleteCheck = { kind: "serviceAccounts" as const, action: "delete" as const, namespace: user.namespace, name: user.name };
  const checks = [createCheck, ...(existing ? [deleteCheck] : []), { kind: "clusterRoles" as const, action: "list" as const, namespace: null }, ...[...new Set([...user.assignments.map(a => a.templateName), ...(user.clusterTemplate ? [user.clusterTemplate.name] : [])])].slice(0, 29).map(name => ({ kind: "clusterRoles" as const, action: "get" as const, namespace: null, name }))];
  const permissions = usePermissionChecks(checks);
  const verified = checks.filter(c => c.action !== "delete" && c.action !== "create" && c.action !== "update").every(c => permissions.decision(c) === "allowed");
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; if (current.current) void cancelManagedUsers(current.current).catch(() => {}); }; }, []);
  useEffect(() => { if (!plan) return; reviewRegion.current?.focus(); const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [plan]);
  useEffect(() => {
    if (!plan || applying.current || planEpoch === permissions.epoch) return;
    generation.current++;
    if (current.current) { void cancelManagedUsers(current.current).catch(() => {}); current.current = null; }
    setPlan(null); setPlanEpoch(null); setBusy(false); inFlight.current = false;
    setError("Access identity changed. Review changes again.");
  }, [plan, planEpoch, permissions.epoch]);
  const cancel = () => {
    if (applying.current) {
      if (current.current) { void cancelManagedUsers(current.current).catch(() => {}); current.current = null; }
      setError("Cancellation requested. Submitted changes may already have been applied. Refresh Users before making further changes; cancellation is not a rollback.");
      return;
    }
    generation.current++;
    if (current.current) void cancelManagedUsers(current.current).catch(() => {});
    current.current = null; setPlan(null); setPlanEpoch(null);
    setBusy(false); inFlight.current = false; reviewButton.current?.focus();
  };
  const change = (next: ManagedUser) => { if (inFlight.current || result || consumed) return; cancel(); setError(null); setUser(next); };
  const close = () => {
    if (applying.current) return;
    cancel(); onClose(!!result || consumed);
  };
  const selectedTemplatesValid = user.assignments.every(a => templates.some(t => t.scope === "namespaced" && t.name === a.templateName && t.uid === a.templateUid && t.resourceVersion === a.templateResourceVersion)) && (user.clusterTemplate === null || templates.some(t => t.scope === "cluster" && t.name === user.clusterTemplate?.name && t.uid === user.clusterTemplate.uid && t.resourceVersion === user.clusterTemplate.resourceVersion && (user.clusterAccess !== "read" || readOnlyTemplate(t))));
  const canReview = !busy && !result && !consumed && verified && permissions.decision(createCheck) === "allowed" && validManagedUser(user) && selectedTemplatesValid;
  const review = async (operation: Operation) => {
    if (inFlight.current || result || !verified || permissions.decision(operation === "delete" ? deleteCheck : createCheck) !== "allowed" || !validManagedUser(operation === "delete" ? initial : user)) return;
    inFlight.current = true; setBusy(true); setError(null); setPlan(null);
    const request = { clusterId, sessionId, readId: nextReadId(), operation, user: operation === "delete" ? initial : user };
    current.current = request; const id = ++generation.current;
    const epoch = permissions.authorizationEpoch();
    try { const value = await planManagedUser(request); if (active.current && id === generation.current) {
      if (epoch === null || epoch !== permissions.authorizationEpoch()) {
        void cancelManagedUsers(request).catch(() => {}); current.current = null;
        setError("Access identity changed. Review changes again.");
      } else { setNow(Date.now()); setPlanEpoch(epoch); setPlan(value); }
    } }
    catch (reason) { if (active.current && id === generation.current) setError(connectionMessage(errorCode(reason))); }
    finally { if (active.current && id === generation.current) { setBusy(false); inFlight.current = false; } }
  };
  const apply = async () => {
    if (!plan || planEpoch === null || planEpoch !== permissions.authorizationEpoch() || plan.expiresAt <= Date.now() || inFlight.current || result || !verified || permissions.decision(plan.operation === "delete" ? deleteCheck : createCheck) !== "allowed") return;
    inFlight.current = true; applying.current = true; setConsumed(true); setBusy(true); setError(null);
    const request = { clusterId, sessionId, readId: nextReadId(), planId: plan.planId };
    current.current = request; const id = ++generation.current;
    setPlan(null);
    try { const value = await applyManagedUser(request, plan); if (active.current && id === generation.current) setResult(value); }
    catch (reason) { if (active.current && id === generation.current) setError(`${connectionMessage(errorCode(reason))} The confirmation was consumed. Submitted changes may already have been applied. Return to Users and refresh before reviewing another change.`); }
    finally { if (active.current) { applying.current = false; setBusy(false); } }
  };
  const selectedRules: PlanSummary[] = user.assignments.flatMap(a => (templates.find(t => t.name === a.templateName)?.rules ?? []).map(r => ({ ...r, namespaces: a.allNamespaces ? null : a.namespaces })));
  if (user.clusterTemplate) selectedRules.push(...(templates.find(t => t.name === user.clusterTemplate?.name)?.rules ?? []).map(r => ({ ...r, namespaces: null })));
  const replaceAssignment = (index: number, a: Assignment) => change({ ...user, assignments: user.assignments.map((old, i) => i === index ? a : old) });
  return <Dialog isOpen purpose={busy || plan ? "required" : "form"} width="min(56rem, 100%)" onOpenChange={open => { if (!open) close(); }}>
    <DialogHeader title={existing ? `Edit ${initial.name}` : "Create New User"} onOpenChange={applying.current ? undefined : open => { if (!open) close(); }} />
    <VStack gap={5} padding={6} style={{ minHeight: 0, minWidth: 0, overflow: "auto", overflowWrap: "anywhere" }} onKeyDown={event => { if (event.key === "Escape" && plan) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    <Text type="supporting">A managed user is a Kubernetes ServiceAccount. Credentials are not generated by saving this user.</Text>
    {error && <Text role="alert">{error}</Text>}
    {result ? <VStack gap={3} role="region" aria-label="Change results">
      <Heading level={3}>{result.complete ? "Changes applied" : "Changes partially applied"}</Heading>
      {!result.complete && <Text role="alert">Execution stopped. Applied changes are not rolled back. Refresh Users before reviewing another change.</Text>}
      {result.results.map((row, i) => <Text key={i}>{row.operation} {row.kind} {row.namespace ? `${row.namespace}/` : ""}{row.name}: {row.state} ({row.messageCode})</Text>)}
    </VStack> : plan ? <VStack gap={4} ref={reviewRegion} tabIndex={-1} role="region" aria-label="Review user changes">
      <Heading level={3}>Review changes</Heading>
      <Text>{plan.operation} {plan.user.namespace}/{plan.user.name}. Server dry-run completed. Confirm only the changes below.</Text>
      {plan.warnings.map((warning, i) => <Text key={i} role="status">{warning}</Text>)}
      <ManagedRuleSummary rows={plan.summary} />
      <Heading level={4}>Planned steps</Heading>
      {plan.steps.map((step, i) => <Text key={i}>{step.operation} {step.kind} {step.namespace ? `${step.namespace}/` : ""}{step.name}</Text>)}
      {now >= plan.expiresAt && <Text role="alert">This review expired. Return to editing and review again.</Text>}
      <HStack gap={2} wrap="wrap">
        <Button label="Back to editing" variant="ghost" onClick={cancel} />
        <Button label={`Confirm ${plan.operation === "update" ? "save" : plan.operation}`} isDisabled={busy || planEpoch === null || planEpoch !== permissions.epoch || now >= plan.expiresAt || !verified || permissions.decision(plan.operation === "delete" ? deleteCheck : createCheck) !== "allowed"} onClick={() => void apply()} />
      </HStack>
    </VStack> : <>
      <TextInput label="Name" value={user.name} isReadOnly={existing} isDisabled={busy} onChange={name => change({ ...user, name })} />
      <Text>User namespace: {user.namespace}</Text>
      <Heading level={3}>Namespaced resources</Heading>
      {user.assignments.map((a, index) => <Card key={index} padding={4}><VStack gap={3}>
        <HStack gap={3} wrap="wrap" vAlign="end">
          <Selector label={`Template ${index + 1}`} hasSearch width="100%" value={a.templateName} placeholder="Choose existing template" isDisabled={busy} options={templates.filter(t => t.scope === "namespaced" && !user.assignments.some((other, i) => i !== index && other.templateName === t.name)).map(t => ({ value: t.name, label: label(t) }))} onChange={name => { const t = templates.find(t => t.name === name); if (t) replaceAssignment(index, { ...a, templateName: t.name, templateUid: t.uid, templateResourceVersion: t.resourceVersion }); }} />
          <Button label={`Remove template ${index + 1}`} variant="ghost" isDisabled={busy} onClick={() => change({ ...user, assignments: user.assignments.filter((_, i) => i !== index) })} />
        </HStack>
        <NamespaceMultiSelect assignment={a} index={index} userNamespace={user.namespace} busy={busy || consumed} onChange={next => replaceAssignment(index, next)} />
      </VStack></Card>)}
      <Button label="Add template" variant="ghost" isDisabled={busy || user.assignments.length >= 32 || !templates.some(t => t.scope === "namespaced" && !user.assignments.some(a => a.templateName === t.name))} onClick={() => change({ ...user, assignments: [...user.assignments, { templateName: "", templateUid: "", templateResourceVersion: "", namespaces: [], allNamespaces: false }] })} />
      <RadioList label="Cluster resources" value={user.clusterAccess} isDisabled={busy} orientation="horizontal" onChange={value => { if (value === "none" || value === "read" || value === "write") change({ ...user, clusterAccess: value, clusterTemplate: null }); }}>
        <RadioListItem value="none" label="None" /><RadioListItem value="read" label="Read Only" /><RadioListItem value="write" label="Read Write" />
      </RadioList>
      {user.clusterAccess !== "none" && <Selector label="Cluster template" hasSearch width="100%" value={user.clusterTemplate?.name ?? ""} placeholder="Choose existing cluster template" isDisabled={busy} options={templates.filter(t => t.scope === "cluster" && (user.clusterAccess === "write" || readOnlyTemplate(t))).map(t => ({ value: t.name, label: label(t) }))} onChange={name => { const t = templates.find(t => t.name === name); if (t) change({ ...user, clusterTemplate: { name: t.name, uid: t.uid, resourceVersion: t.resourceVersion } }); }} />}
      {user.clusterAccess === "read" && user.clusterTemplate && !templates.some(t => t.name === user.clusterTemplate?.name && readOnlyTemplate(t)) && <Text role="alert">The saved cluster template is incompatible with Read Only. It may include wildcard groups, proxy or interactive resources, or non-resource verbs other than get. Choose a compatible template, None, or Read Write to match its actual rules. No access has been changed.</Text>}
      <Text type="supporting">Labels do not limit actual rules. Review the exact verbs, resources, resource names and namespaces below. Existing templates are used without adding wildcard grants.</Text>
      <ManagedRuleSummary rows={selectedRules} />
      {checks.some(c => permissions.decision(c) !== "allowed") && <Text role="status">Required access is denied or unverified. Review is disabled until permission checks allow this action.</Text>}
      <HStack gap={2} wrap="wrap">
        <Button ref={reviewButton} label={busy ? "Reviewing changes…" : "Review changes"} isDisabled={!canReview} onClick={() => void review(existing ? "update" : "create")} />
        {existing && <Button label="Delete user" variant="ghost" isDisabled={busy || consumed || !verified || permissions.decision(deleteCheck) !== "allowed"} onClick={() => void review("delete")} />}
        {busy && <Button label="Cancel request" variant="ghost" onClick={cancel} />}
      </HStack>
    </>}
    </VStack>
  </Dialog>;
}
