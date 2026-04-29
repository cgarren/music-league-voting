"use client";

import { useMemo, useState, useTransition } from "react";
import {
    addManualTopic,
    mergeTopics,
    removeTopics,
    updateTopic,
} from "@/app/actions/admin";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";

type TopicRow = {
    id: string;
    topic_text: string;
    submitter: string;
};

export function TopicEditor({
    topics,
    defaultOpen,
    sessionId,
    canAddTopic,
}: {
    topics: TopicRow[];
    defaultOpen: boolean;
    sessionId: string;
    canAddTopic: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [topicInput, setTopicInput] = useState("");
    const [submitterInput, setSubmitterInput] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [mergeTopicInput, setMergeTopicInput] = useState("");
    const [mergeSubmitterInput, setMergeSubmitterInput] = useState("");
    const [addTopicInput, setAddTopicInput] = useState("");
    const [addSubmitterInput, setAddSubmitterInput] = useState("");
    const [confirmAction, setConfirmAction] = useState<
        "merge" | "remove" | "add" | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const byId = useMemo(
        () => new Map(topics.map((topic) => [topic.id, topic])),
        [topics],
    );

    const startEdit = (topic: TopicRow) => {
        setEditingId(topic.id);
        setTopicInput(topic.topic_text);
        setSubmitterInput(topic.submitter);
        setError(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setTopicInput("");
        setSubmitterInput("");
    };

    const saveEdit = (topicId: string) => {
        setError(null);
        startTransition(async () => {
            try {
                await updateTopic({
                    topic_id: topicId,
                    topic: topicInput,
                    submitter: submitterInput,
                });
                cancelEdit();
            } catch (e) {
                setError((e as Error).message);
            }
        });
    };

    const toggleSelected = (topicId: string) => {
        setSelectedIds((prev) =>
            prev.includes(topicId)
                ? prev.filter((id) => id !== topicId)
                : [...prev, topicId],
        );
    };

    const selectAllTopics = () => {
        setSelectedIds(topics.map((topic) => topic.id));
    };

    const selectNoTopics = () => {
        setSelectedIds([]);
    };

    const runMerge = () => {
        if (selectedIds.length !== 2 || !mergeTopicInput.trim()) return;
        const [targetId, sourceId] = selectedIds;
        if (!targetId || !sourceId) return;
        setError(null);
        startTransition(async () => {
            try {
                await updateTopic({
                    topic_id: targetId,
                    topic: mergeTopicInput,
                    submitter: mergeSubmitterInput,
                });
                await mergeTopics({
                    source_topic_id: sourceId,
                    target_topic_id: targetId,
                });
                setSelectedIds([]);
            } catch (e) {
                setError((e as Error).message);
            }
        });
    };

    const runRemove = () => {
        if (selectedIds.length === 0) return;
        setError(null);
        startTransition(async () => {
            try {
                await removeTopics({ topic_ids: selectedIds });
                setSelectedIds([]);
            } catch (e) {
                setError((e as Error).message);
            }
        });
    };

    const requestMerge = () => {
        if (selectedIds.length !== 2) return;
        const [firstId, secondId] = selectedIds;
        const first = firstId ? byId.get(firstId) : null;
        const second = secondId ? byId.get(secondId) : null;
        const t1 = first?.topic_text.trim() ?? "";
        const t2 = second?.topic_text.trim() ?? "";
        const s1 = first?.submitter.trim() ?? "";
        const s2 = second?.submitter.trim() ?? "";
        setMergeTopicInput(
            t1 && t2 ? `${t1} (${t2})` : t1 || t2 || "Merged topic",
        );
        setMergeSubmitterInput(s1 && s2 ? `${s1} + ${s2}` : s1 || s2);
        setConfirmAction("merge");
    };

    const requestRemove = () => {
        if (selectedIds.length === 0) return;
        setConfirmAction("remove");
    };

    const requestAdd = () => {
        if (!canAddTopic) return;
        setAddTopicInput("");
        setAddSubmitterInput("");
        setConfirmAction("add");
    };

    const runAdd = () => {
        if (!addTopicInput.trim()) return;
        setError(null);
        startTransition(async () => {
            try {
                await addManualTopic({
                    session_id: sessionId,
                    topic: addTopicInput,
                    submitter: addSubmitterInput,
                });
            } catch (e) {
                setError((e as Error).message);
            }
        });
    };

    const confirmAndRun = () => {
        if (confirmAction === "merge") runMerge();
        if (confirmAction === "remove") runRemove();
        if (confirmAction === "add") runAdd();
        setConfirmAction(null);
        setMergeTopicInput("");
        setMergeSubmitterInput("");
        setAddTopicInput("");
        setAddSubmitterInput("");
    };

    return (
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <details
                open={defaultOpen}
                onToggle={(e) =>
                    setIsOpen((e.currentTarget as HTMLDetailsElement).open)
                }
            >
                <summary className="group -mx-2 -mt-2 flex list-none cursor-pointer items-center justify-between rounded-xl px-2 py-2 marker:content-none hover:bg-[color:var(--color-surface-elevated)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold">
                                Topic list editor
                            </h3>
                        </div>
                        <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                            Edit, merge, or remove topics.
                        </p>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2 text-xs text-[color:var(--color-muted)]">
                        <span>{isOpen ? "Collapse" : "Expand"}</span>
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                            className={`shrink-0 transition-transform ${
                                isOpen ? "rotate-180" : "rotate-0"
                            }`}
                        >
                            <path
                                d="M4 6l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </summary>

                {error ? (
                    <p className="mt-3 rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm text-[color:var(--color-danger)]">
                        {error}
                    </p>
                ) : null}

                <div className="mt-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-4">
                    <h4 className="text-sm font-semibold">Selection actions</h4>
                    <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                        Select topics with checkboxes below. Merge is enabled
                        only when exactly two topics are selected.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={requestMerge}
                            disabled={pending || selectedIds.length !== 2}
                            className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {pending ? "Merging…" : "Merge"}
                        </button>
                        <button
                            type="button"
                            onClick={requestRemove}
                            disabled={pending || selectedIds.length < 1}
                            className="rounded-full bg-[color:var(--color-danger)] px-5 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {pending ? "Removing…" : "Remove"}
                        </button>
                        <button
                            type="button"
                            onClick={requestAdd}
                            disabled={pending || !canAddTopic}
                            className="rounded-full bg-[color:var(--color-success)] px-5 py-2 text-sm font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {pending ? "Adding…" : "Add"}
                        </button>
                        <p className="text-xs text-[color:var(--color-muted)]">
                            {selectedIds.length} selected
                        </p>
                    </div>
                </div>

                <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-[color:var(--color-muted)]">
                            Topics ({topics.length})
                        </h4>
                        <div className="flex items-center gap-2 text-xs">
                            <button
                                type="button"
                                onClick={selectAllTopics}
                                disabled={pending || topics.length === 0}
                                className="text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Select all
                            </button>
                            <span className="text-[color:var(--color-border)]">
                                /
                            </span>
                            <button
                                type="button"
                                onClick={selectNoTopics}
                                disabled={pending || selectedIds.length === 0}
                                className="text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Select none
                            </button>
                        </div>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                        {topics.map((topic) => {
                            const isEditing = editingId === topic.id;
                            const liveTopic = byId.get(topic.id) ?? topic;
                            return (
                                <li
                                    key={topic.id}
                                    className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2"
                                >
                                    {isEditing ? (
                                        <div className="flex flex-col gap-2">
                                            <input
                                                type="text"
                                                value={topicInput}
                                                onChange={(e) =>
                                                    setTopicInput(
                                                        e.target.value,
                                                    )
                                                }
                                                maxLength={500}
                                                className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
                                            />
                                            <input
                                                type="text"
                                                value={submitterInput}
                                                onChange={(e) =>
                                                    setSubmitterInput(
                                                        e.target.value,
                                                    )
                                                }
                                                maxLength={200}
                                                placeholder="Submitter (optional)"
                                                className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
                                            />
                                            <div className="flex gap-2 text-xs">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        saveEdit(topic.id)
                                                    }
                                                    disabled={
                                                        pending ||
                                                        !topicInput.trim()
                                                    }
                                                    className="rounded-full bg-[color:var(--color-success)] px-3 py-1.5 font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelEdit}
                                                    disabled={pending}
                                                    className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 font-medium hover:border-[color:var(--color-accent)]"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <label className="flex items-start gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.includes(
                                                            topic.id,
                                                        )}
                                                        onChange={() =>
                                                            toggleSelected(
                                                                topic.id,
                                                            )
                                                        }
                                                        disabled={pending}
                                                        className="mt-0.5 accent-[color:var(--color-accent)]"
                                                    />
                                                    <span className="text-pretty wrap-anywhere">
                                                        {formatTopicDisplay(
                                                            liveTopic.topic_text,
                                                        )}
                                                    </span>
                                                </label>
                                                {liveTopic.submitter ? (
                                                    <p className="mt-0.5 pl-6 text-xs text-[color:var(--color-muted)]">
                                                        {liveTopic.submitter}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2 text-xs">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        startEdit(liveTopic)
                                                    }
                                                    disabled={pending}
                                                    className="text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)]"
                                                >
                                                    edit
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </details>

            {confirmAction ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
                    <div className="w-full max-w-md rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-2xl">
                        <h4 className="text-base font-semibold">
                            {confirmAction === "merge"
                                ? "Confirm merge"
                                : confirmAction === "remove"
                                  ? "Confirm removal"
                                  : "Add topic"}
                        </h4>
                        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                            {confirmAction === "merge"
                                ? "This will merge 2 selected topics, move votes into the kept topic, and remove the duplicate."
                                : confirmAction === "remove"
                                  ? `This will remove ${selectedIds.length} selected ${selectedIds.length === 1 ? "topic" : "topics"}.`
                                  : "Enter a topic and optional submitter, then confirm to add it to the list."}
                        </p>
                        {confirmAction === "merge" ? (
                            <div className="mt-4 space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--color-muted)]">
                                    Preview merged topic + submitter
                                </p>
                                <label className="block text-xs text-[color:var(--color-muted)]">
                                    Topic
                                    <input
                                        type="text"
                                        value={mergeTopicInput}
                                        onChange={(e) =>
                                            setMergeTopicInput(e.target.value)
                                        }
                                        maxLength={500}
                                        className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm text-[color:var(--color-foreground)] focus:border-[color:var(--color-accent)] focus:outline-none"
                                    />
                                </label>
                                <label className="block text-xs text-[color:var(--color-muted)]">
                                    Submitter
                                    <input
                                        type="text"
                                        value={mergeSubmitterInput}
                                        onChange={(e) =>
                                            setMergeSubmitterInput(
                                                e.target.value,
                                            )
                                        }
                                        maxLength={200}
                                        className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm text-[color:var(--color-foreground)] focus:border-[color:var(--color-accent)] focus:outline-none"
                                    />
                                </label>
                            </div>
                        ) : null}
                        {confirmAction === "add" ? (
                            <div className="mt-4 space-y-2">
                                <label className="block text-xs text-[color:var(--color-muted)]">
                                    Topic
                                    <input
                                        type="text"
                                        value={addTopicInput}
                                        onChange={(e) =>
                                            setAddTopicInput(e.target.value)
                                        }
                                        maxLength={500}
                                        className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm text-[color:var(--color-foreground)] focus:border-[color:var(--color-accent)] focus:outline-none"
                                    />
                                </label>
                                <label className="block text-xs text-[color:var(--color-muted)]">
                                    Submitter (optional)
                                    <input
                                        type="text"
                                        value={addSubmitterInput}
                                        onChange={(e) =>
                                            setAddSubmitterInput(
                                                e.target.value,
                                            )
                                        }
                                        maxLength={200}
                                        className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm text-[color:var(--color-foreground)] focus:border-[color:var(--color-accent)] focus:outline-none"
                                    />
                                </label>
                            </div>
                        ) : null}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setConfirmAction(null);
                                    setMergeTopicInput("");
                                    setMergeSubmitterInput("");
                                    setAddTopicInput("");
                                    setAddSubmitterInput("");
                                }}
                                disabled={pending}
                                className="rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmAndRun}
                                disabled={
                                    pending ||
                                    (confirmAction === "merge" &&
                                        !mergeTopicInput.trim()) ||
                                    (confirmAction === "add" &&
                                        !addTopicInput.trim())
                                }
                                className={
                                    confirmAction === "remove"
                                        ? "rounded-full bg-[color:var(--color-danger)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                        : confirmAction === "add"
                                          ? "rounded-full bg-[color:var(--color-success)] px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                          : "rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                                }
                            >
                                {confirmAction === "merge"
                                    ? "Confirm merge"
                                    : confirmAction === "remove"
                                      ? "Confirm remove"
                                      : "Confirm add"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
