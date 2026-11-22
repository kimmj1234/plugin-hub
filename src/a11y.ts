import type { KeyboardEvent } from "react";

/**
 * 목록 줄(li)을 키보드로도 고를 수 있게 한다: Tab으로 이동, Enter·Space로 선택.
 * 줄 안의 스위치·버튼에서 누른 키는 그 버튼이 처리하도록 건드리지 않는다.
 */
export function selectable(onSelect: () => void, selected: boolean) {
  return {
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    "aria-current": selected ? ("true" as const) : undefined,
  };
}
