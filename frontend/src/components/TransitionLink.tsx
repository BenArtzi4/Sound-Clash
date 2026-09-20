import type { MouseEvent } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { useViewTransitionNavigate } from "../hooks/useViewTransitionNavigate";

interface Props extends LinkProps {
  preload?: () => Promise<unknown>;
}

// A <Link> that keeps its href/role (tests, middle-click, screen readers) and
// routes a plain left click through the view-transition hook. Every modified
// click — middle/right button, Cmd/Ctrl/Shift/Alt, a target, or an onClick that
// already called preventDefault — falls through to the browser's and the
// router's own handling untouched.
export function TransitionLink({
  preload,
  onClick,
  to,
  replace,
  state,
  preventScrollReset,
  ...rest
}: Props) {
  const go = useViewTransitionNavigate();
  return (
    <Link
      to={to}
      replace={replace}
      state={state}
      preventScrollReset={preventScrollReset}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        // `replace`/`state`/`preventScrollReset` are forwarded so the intercepted
        // path behaves exactly like the <Link> it replaces.
        void go(to, { preload, replace, state, preventScrollReset });
      }}
    />
  );
}
