import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

interface Props {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
}

export function Skeleton({ width, height, radius, className }: Props) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;
  if (radius !== undefined)
    style.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
  return (
    <span
      className={`${styles.skeleton}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}
