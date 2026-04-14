"use client";
import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, Loader, Modal, useToast } from "@novaflix/ui";
import type { Content } from "@novaflix/shared";

const ITEMS_PER_PAGE = 10;

export default function ContentListPage() {
  const router = useRouter();
  const toast = useToast();
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "movie" | "series">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Content | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function fetchContent() {
      try {
        const q = query(collection(db(), "content"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        setContent(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Content)));
      } catch (err) {
        console.error("Failed to fetch content:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchContent();
  }, []);

  const filtered = useMemo(() => {
    return content.filter((item) => {
      const matchSearch =
        !search || item.title.toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === "all" || item.type === typeFilter;
      const matchStatus = statusFilter === "all" || item.status === statusFilter;
      return matchSearch && matchType && matchStatus;
    });
  }, [content, search, typeFilter, statusFilter]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db(), "content", deleteTarget.id));
      setContent((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("Content deleted successfully");
    } catch (err) {
      console.error("Failed to delete content:", err);
      toast.error("Failed to delete content");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Content</h1>
            <p className="text-[var(--muted)] mt-1">
              Manage movies and series on your platform
            </p>
          </div>
          <Link href="/content/new">
            <Button>
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add New Content
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search by title..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as typeof typeFilter);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="all">All Types</option>
            <option value="movie">Movie</option>
            <option value="series">Series</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader />
          </div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Thumbnail</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Title</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Type</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Genre</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-[var(--muted)]">
                        No content found.
                      </td>
                    </tr>
                  ) : (
                    paginated.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
                      >
                        <td className="px-4 py-3">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="w-12 h-8 rounded object-cover"
                            />
                          ) : (
                            <div className="w-12 h-8 rounded bg-[var(--background)] flex items-center justify-center">
                              <svg className="w-4 h-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5" />
                              </svg>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{item.title}</td>
                        <td className="px-4 py-3">
                          <span className="capitalize px-2 py-0.5 rounded text-xs bg-[var(--primary)]/10 text-[var(--primary)]">
                            {item.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {item.genre?.slice(0, 2).join(", ")}
                          {(item.genre?.length || 0) > 2 && "..."}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              item.status === "published"
                                ? "bg-[var(--success)]/10 text-[var(--success)]"
                                : "bg-[var(--warning)]/10 text-[var(--warning)]"
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {item.createdAt?.toDate?.()
                            ? item.createdAt.toDate().toLocaleDateString()
                            : "N/A"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => router.push(`/content/${item.id}`)}
                              className="p-1.5 rounded-lg hover:bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteTarget(item)}
                              className="p-1.5 rounded-lg hover:bg-[var(--danger)]/10 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                <p className="text-sm text-[var(--muted)]">
                  Showing {(page - 1) * ITEMS_PER_PAGE + 1} to{" "}
                  {Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Content"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[var(--muted)]">
            Are you sure you want to delete <strong className="text-[var(--foreground)]">{deleteTarget?.title}</strong>? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
