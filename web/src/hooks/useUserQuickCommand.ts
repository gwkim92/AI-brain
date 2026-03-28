"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/lib/api/client";
import { createJarvisRequest } from "@/lib/api/endpoints";
import { useLocale } from "@/components/providers/LocaleProvider";

type UserQuickCommandResult = {
  commandInput: string;
  setCommandInput: (value: string) => void;
  isSubmitting: boolean;
  error: string | null;
  execute: (input?: string) => Promise<void>;
};

function resolveTaskHref(taskId?: string | null, sessionId?: string | null): string {
  if (taskId && taskId.trim().length > 0) {
    return `/tasks/${taskId}`;
  }
  if (sessionId && sessionId.trim().length > 0) {
    return `/tasks?session=${encodeURIComponent(sessionId)}`;
  }
  return "/tasks";
}

export function useUserQuickCommand(): UserQuickCommandResult {
  const router = useRouter();
  const { t } = useLocale();
  const [commandInput, setCommandInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input?: string) => {
    const prompt = (input ?? commandInput).trim();
    if (!prompt) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createJarvisRequest({
        prompt,
        source: "user_shell",
      });
      setCommandInput("");
      router.push(resolveTaskHref(result.delegation.task_id, result.session.id));
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("commandBar.error.createTask"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [commandInput, router, t]);

  return useMemo(() => ({
    commandInput,
    setCommandInput,
    isSubmitting,
    error,
    execute,
  }), [commandInput, error, execute, isSubmitting]);
}
