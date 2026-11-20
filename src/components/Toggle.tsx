export function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={disabled ? "이 앱에서 바꿀 수 없는 항목입니다" : label}
      className={`toggle ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    >
      <span className="knob" />
    </button>
  );
}
