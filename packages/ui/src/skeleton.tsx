"use client";
import React from "react";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-[var(--border)] rounded-lg ${className}`} />
  );
}
