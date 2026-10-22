/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import Joi from "joi";
import * as yaml from "js-yaml";

const clusterSchema = Joi.object({
  name: Joi.string().min(1).required(),
  cluster: Joi.object({
    server: Joi.string().min(1).required(),
  }).required(),
});

const userSchema = Joi.object({
  name: Joi.string().min(1).required(),
});

const contextSchema = Joi.object({
  name: Joi.string().min(1).required(),
  context: Joi.object({
    cluster: Joi.string().min(1).required(),
    user: Joi.string().min(1).required(),
  }),
});

const kubeConfigSchema = Joi.object({
  users: Joi.array().items(userSchema).optional(),
  clusters: Joi.array().items(clusterSchema).optional(),
  contexts: Joi.array().items(contextSchema).optional(),
  "current-context": Joi.string().min(1).failover("default"),
}).required();

/** Raw validated YAML, deliberately independent of Kubernetes auth and filesystem code. */
export interface KubeConfigDocument {
  clusters?: { name: string; cluster: { server: string } }[];
  users?: { name: string }[];
  contexts?: { name: string; context?: { cluster: string; user: string } }[];
  "current-context"?: string;
}

/** Preserve the legacy two-pass validation: report errors, then salvage valid array entries.
 * YAML syntax errors still throw; callers must never surface their secret-bearing messages.
 */
export function validateKubeConfigDocument(rawYaml: string): {
  document: KubeConfigDocument;
  error: Joi.ValidationError | undefined;
} {
  // js-yaml v5 throws on empty input instead of returning undefined.
  const parsed = rawYaml.trim() ? yaml.load(rawYaml) : undefined;
  const { error } = kubeConfigSchema.validate(parsed, { abortEarly: false, allowUnknown: true });
  const { value } = kubeConfigSchema.validate(parsed, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: { arrays: true },
  });

  return { document: value ?? {}, error };
}
