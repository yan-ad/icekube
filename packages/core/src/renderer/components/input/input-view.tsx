/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./input.scss";
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react";

export interface InputViewProps {
  id?: string;
  className: string;
  inputProps: InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<any> };
  multiLine?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  contentRight?: ReactNode;
  tooltip?: ReactNode;
  info?: ReactNode;
}

export function InputView({
  id,
  className,
  inputProps,
  multiLine,
  iconLeft,
  iconRight,
  contentRight,
  tooltip,
  info,
}: InputViewProps) {
  return (
    <div id={id} className={className}>
      {tooltip}
      <label className="input-area flex items-center gap-2" id="">
        {iconLeft}
        {multiLine ? <textarea {...inputProps} /> : <input {...inputProps} />}
        {iconRight}
        {contentRight}
      </label>
      <div className="input-info flex gap-2">{info}</div>
    </div>
  );
}
