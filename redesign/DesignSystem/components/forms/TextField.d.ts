import * as React from 'react';

type Option = string | { label: string; value: string };

export interface TextFieldProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  label?: React.ReactNode;
  /** Control type. Default `input`. */
  as?: 'input' | 'textarea' | 'select';
  type?: string;
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  placeholder?: string;
  /** Helper text under the field. */
  hint?: React.ReactNode;
  /** Error message — turns the border red and replaces the hint. */
  error?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Options for `as="select"`. */
  options?: Option[];
  rows?: number;
  id?: string;
}

/**
 * Square hairline field (input / textarea / select) with a mono label.
 *
 * @startingPoint section="Forms" subtitle="Labelled input / select / textarea" viewport="700x260"
 */
export function TextField(props: TextFieldProps): React.ReactElement;
