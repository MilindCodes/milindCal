"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Archive, Check, ChevronLeft, ExternalLink, Mail, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import type { GmailMessageDetail, GmailMessageSummary } from "@/lib/models";

const TASK_STORAGE_KEY = "milindcal.tasks.v1";

interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

export function TasksSidebar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [activePanel, setActivePanel] = useState<"tasks" | "emails">("tasks");
  const [emails, setEmails] = useState<GmailMessageSummary[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<GmailMessageDetail | null>(null);
  const [emailDetailLoading, setEmailDetailLoading] = useState(false);
  const [emailDetailError, setEmailDetailError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [emailActionLoading, setEmailActionLoading] = useState<"archive" | "reply" | null>(null);
  const [emailActionStatus, setEmailActionStatus] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Task[];
      setTasks(Array.isArray(parsed) ? parsed : []);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const remainingCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);

  const readEmails = useCallback(async () => {
    setEmailsLoading(true);
    setEmailsError(null);

    try {
      const response = await fetch("/api/google/emails?max=8", {
        cache: "no-store"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to sync Gmail");
      }

      const data = (await response.json()) as { emails: GmailMessageSummary[] };
      setEmails(Array.isArray(data.emails) ? data.emails : []);
    } catch (error) {
      setEmailsError(error instanceof Error ? error.message : "Unable to sync Gmail");
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  const openEmail = useCallback(async (emailId: string) => {
    setSelectedEmailId(emailId);
    setSelectedEmail(null);
    setEmailDetailLoading(true);
    setEmailDetailError(null);
    setEmailActionStatus(null);

    try {
      const response = await fetch(`/api/google/emails/${emailId}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to open email");
      }

      const data = (await response.json()) as { email: GmailMessageDetail };
      setSelectedEmail(data.email);
      setReplyText("");
    } catch (error) {
      setEmailDetailError(error instanceof Error ? error.message : "Unable to open email");
    } finally {
      setEmailDetailLoading(false);
    }
  }, []);

  const closeEmail = useCallback(() => {
    setSelectedEmailId(null);
    setSelectedEmail(null);
    setEmailDetailLoading(false);
    setEmailActionLoading(null);
    setEmailDetailError(null);
    setEmailActionStatus(null);
    setReplyText("");
  }, []);

  const archiveSelectedEmail = useCallback(async () => {
    if (!selectedEmail) return;

    setEmailActionLoading("archive");
    setEmailDetailError(null);
    setEmailActionStatus(null);

    try {
      const response = await fetch(`/api/google/emails/${selectedEmail.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "archive" })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to archive email");
      }

      setEmails((previous) => previous.filter((email) => email.id !== selectedEmail.id));
      setSelectedEmailId(null);
      setSelectedEmail(null);
      setReplyText("");
      setEmailActionStatus("Email archived.");
    } catch (error) {
      setEmailDetailError(error instanceof Error ? error.message : "Unable to archive email");
    } finally {
      setEmailActionLoading(null);
    }
  }, [selectedEmail]);

  const sendReply = useCallback(async () => {
    if (!selectedEmail) return;
    const shortReply = replyText.trim();
    if (!shortReply) return;

    setEmailActionLoading("reply");
    setEmailDetailError(null);
    setEmailActionStatus(null);

    try {
      const response = await fetch(`/api/google/emails/${selectedEmail.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "reply",
          replyText: shortReply
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to send reply");
      }

      setReplyText("");
      setEmailActionStatus("Reply sent.");
    } catch (error) {
      setEmailDetailError(error instanceof Error ? error.message : "Unable to send reply");
    } finally {
      setEmailActionLoading(null);
    }
  }, [replyText, selectedEmail]);

  useEffect(() => {
    if (activePanel !== "emails") return;
    if (emails.length > 0 || emailsLoading || emailsError) return;
    void readEmails();
  }, [activePanel, emails.length, emailsLoading, emailsError, readEmails]);

  useEffect(() => {
    if (activePanel === "tasks") {
      closeEmail();
    }
  }, [activePanel, closeEmail]);

  const addTask = () => {
    const title = inputValue.trim();
    if (!title) return;

    setTasks((previous) => [
      {
        id: uuid(),
        title,
        completed: false,
        createdAt: Date.now()
      },
      ...previous
    ]);
    setInputValue("");
  };

  const toggleTask = (id: string) => {
    setTasks((previous) =>
      previous.map((task) =>
        task.id === id
          ? {
              ...task,
              completed: !task.completed
            }
          : task
      )
    );
  };

  const deleteTask = (id: string) => {
    setTasks((previous) => previous.filter((task) => task.id !== id));
  };

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className="tasks-sidebar"
      initial={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
      whileHover={{ y: -2 }}
    >
      <div className="tasks-header">
        <h2>{activePanel === "tasks" ? "Tasks" : "Gmail"}</h2>
        <span>{activePanel === "tasks" ? `${remainingCount} open` : `${emails.length} emails`}</span>
      </div>

      <div className="sidebar-switcher" role="tablist" aria-label="Sidebar section switcher">
        <button
          aria-selected={activePanel === "tasks"}
          className={activePanel === "tasks" ? "active" : ""}
          onClick={() => setActivePanel("tasks")}
          role="tab"
          type="button"
        >
          Tasks
        </button>
        <button
          aria-selected={activePanel === "emails"}
          className={activePanel === "emails" ? "active" : ""}
          onClick={() => setActivePanel("emails")}
          role="tab"
          type="button"
        >
          Email
        </button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {activePanel === "tasks" ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="tasks-panel"
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: 8 }}
            key="tasks"
            transition={{ duration: 0.18 }}
          >
            <motion.div className="task-input-row" layout>
              <input
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    addTask();
                  }
                }}
                placeholder="Add a task"
                value={inputValue}
              />
              <motion.button
                onClick={addTask}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                type="button"
                whileHover={{ scale: 1.08, rotate: 8 }}
                whileTap={{ scale: 0.94, rotate: -6 }}
              >
                <Plus size={16} />
              </motion.button>
            </motion.div>

            <motion.div
              animate="show"
              initial="hidden"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } }
              }}
            >
              <AnimatePresence initial={false}>
                {tasks.map((task) => (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="task-item"
                    exit={{ opacity: 0, y: -8 }}
                    initial={{ opacity: 0, y: 12 }}
                    key={task.id}
                    layout
                    transition={{ type: "spring", stiffness: 240, damping: 22 }}
                    whileHover={{ x: 3, scale: 1.01 }}
                  >
                    <motion.button
                      className={`task-toggle ${task.completed ? "done" : ""}`}
                      onClick={() => toggleTask(task.id)}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      type="button"
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                    >
                      <Check size={14} />
                    </motion.button>

                    <p className={task.completed ? "completed" : ""}>{task.title}</p>

                    <motion.button
                      aria-label="Delete task"
                      className="task-delete"
                      onClick={() => deleteTask(task.id)}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      type="button"
                      whileHover={{ scale: 1.07, rotate: -4 }}
                      whileTap={{ scale: 0.92 }}
                    >
                      <Trash2 size={14} />
                    </motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        ) : (
          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="email-placeholder"
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: 8 }}
            key="emails"
            transition={{ duration: 0.18 }}
          >
            <div className="email-placeholder-title">
              <Mail size={16} />
              <h3>{selectedEmailId ? "Email" : "Inbox"}</h3>
              {selectedEmailId ? (
                <button className="email-refresh" onClick={closeEmail} type="button">
                  <ChevronLeft size={14} />
                  Back
                </button>
              ) : null}
              <button
                className="email-refresh"
                onClick={() => void readEmails()}
                type="button"
                disabled={emailsLoading}
              >
                <RefreshCw size={14} className={emailsLoading ? "spin" : ""} />
                Refresh
              </button>
            </div>
            {emailsError ? <p className="email-status error">{emailsError}</p> : null}
            {emailDetailError ? <p className="email-status error">{emailDetailError}</p> : null}
            {emailActionStatus ? <p className="email-status">{emailActionStatus}</p> : null}
            {emailsLoading && !selectedEmailId ? <p className="email-status">Syncing Gmail...</p> : null}
            {!emailsLoading && !emailsError && emails.length === 0 && !selectedEmailId ? (
              <p className="email-status">No inbox emails found.</p>
            ) : null}

            {selectedEmailId ? (
              <section className="email-detail">
                {emailDetailLoading ? <p className="email-status">Loading full email…</p> : null}
                {!emailDetailLoading ? (
                  <>
                    {selectedEmail ? (
                      <>
                        <p className="email-detail-subject">{selectedEmail.subject}</p>
                        <p className="email-detail-meta">
                          <strong>From:</strong> {selectedEmail.from}
                        </p>
                        <p className="email-detail-meta">
                          <strong>To:</strong> {selectedEmail.to}
                        </p>
                        <p className="email-detail-meta">
                          {new Date(selectedEmail.date).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit"
                          })}
                        </p>
                        <div className="email-detail-body">{selectedEmail.body}</div>
                      </>
                    ) : (
                      <p className="email-status error">Unable to load this email.</p>
                    )}

                    <div className="email-actions">
                      {selectedEmail ? (
                        <a
                          className="ghost-button email-link"
                          href={`https://mail.google.com/mail/u/0/#inbox/${selectedEmail.threadId || selectedEmail.id}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={14} />
                          Open in Gmail
                        </a>
                      ) : null}
                      <button
                        className="ghost-button"
                        disabled={!selectedEmail || emailActionLoading === "archive"}
                        onClick={() => void archiveSelectedEmail()}
                        type="button"
                      >
                        <Archive size={14} />
                        {emailActionLoading === "archive" ? "Archiving..." : "Archive"}
                      </button>
                    </div>

                    <div className="email-reply-box">
                      <label htmlFor="quick-reply">Quick reply</label>
                      <textarea
                        id="quick-reply"
                        maxLength={600}
                        onChange={(event) => setReplyText(event.target.value)}
                        placeholder="Thanks, got it. I’ll follow up shortly."
                        rows={3}
                        value={replyText}
                      />
                      <button
                        className="primary-button email-send"
                        disabled={!selectedEmail || !replyText.trim() || emailActionLoading === "reply"}
                        onClick={() => void sendReply()}
                        type="button"
                      >
                        <Send size={14} />
                        {emailActionLoading === "reply" ? "Sending..." : "Send reply"}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            ) : (
              <div className="email-list">
                {emails.map((email) => (
                  <article className={`email-item ${email.isUnread ? "unread" : ""}`} key={email.id}>
                    <div className="email-item-header">
                      <p className="email-from">{email.from}</p>
                      <time dateTime={email.date}>
                        {new Date(email.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric"
                        })}
                      </time>
                    </div>
                    <p className="email-subject">{email.subject}</p>
                    <p className="email-snippet">{email.snippet}</p>
                    <div className="email-item-actions">
                      <button className="ghost-button" onClick={() => void openEmail(email.id)} type="button">
                        Open
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
