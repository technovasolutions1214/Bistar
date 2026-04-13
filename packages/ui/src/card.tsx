"use client";
import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = "", hover = false, onClick }: CardProps) {
  return (
    <div
      className={`rounded-xl bg-[var(--card)] border border-[var(--border)] ${
        hover ? "hover:bg-[var(--card-hover)] cursor-pointer transition-colors" : ""
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
