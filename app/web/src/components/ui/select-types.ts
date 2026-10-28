export interface SelectOption<V extends string | number = string> {
  value: V
  label: string
  disabled?: boolean
}
