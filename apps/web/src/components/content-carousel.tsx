"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Content } from "@novaflix/shared";

interface ContentCarouselProps {
  title: string;
  items: Content[];
}

export function ContentCarousel({ title, items }: ContentCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (items.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold mb-4 px-4 sm:px-6 lg:px-8">
        {title}
      </h2>

      <div className="relative group">
        {/* Left Arrow */}
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-[var(--background)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Scroll left"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        {/* Scroll Container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide px-4 sm:px-6 lg:px-8 scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/content/${item.id}`}
              className="flex-shrink-0 w-[160px] sm:w-[200px] md:w-[240px] group/card"
            >
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[var(--card)]">
                <Image
                  src={item.thumbnail}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover/card:scale-105"
                  sizes="(max-width: 640px) 160px, (max-width: 768px) 200px, 240px"
                />
                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                  <p className="text-sm font-medium line-clamp-2">
                    {item.title}
                  </p>
                  <span className="text-xs text-[var(--muted)] mt-1 capitalize">
                    {item.type}
                  </span>
                </div>
                {/* Type Badge */}
                <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-[var(--primary)]/90 text-white">
                  {item.type}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium line-clamp-1 group-hover/card:text-[var(--primary)] transition-colors">
                {item.title}
              </p>
            </Link>
          ))}
        </div>

        {/* Right Arrow */}
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-[var(--background)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Scroll right"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </section>
  );
}
