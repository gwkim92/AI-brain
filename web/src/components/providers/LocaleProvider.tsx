"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  APP_LOCALE_CHANGED_EVENT,
  type AppLocale,
  type AppLocalePreference,
  getLocaleTag,
  readLocalePreference,
  resolveLocale,
  translate,
  type TranslationKey,
  writeLocalePreference,
} from "@/lib/locale";

type LocaleContextValue = {
  locale: AppLocale;
  localeTag: string;
  preference: AppLocalePreference;
  setPreference: (preference: AppLocalePreference) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatDateTime: (value: string | Date | number | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: string | Date | number | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function formatWithLocale(
  value: string | Date | number | null | undefined,
  localeTag: string,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(localeTag, options).format(date);
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] = useState<AppLocalePreference>("auto");
  const [locale, setLocale] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    const applyPreference = () => {
      const nextPreference = readLocalePreference();
      setPreferenceState(nextPreference);
      setLocale(resolveLocale(nextPreference, initialLocale));
    };

    applyPreference();

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "jarvis.app.locale") {
        applyPreference();
      }
    };

    const onLocaleChanged = () => {
      applyPreference();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(APP_LOCALE_CHANGED_EVENT, onLocaleChanged as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(APP_LOCALE_CHANGED_EVENT, onLocaleChanged as EventListener);
    };
  }, [initialLocale]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    const localeTag = getLocaleTag(locale);
    return {
      locale,
      localeTag,
      preference,
      setPreference: (nextPreference) => {
        setPreferenceState(nextPreference);
        setLocale(resolveLocale(nextPreference, initialLocale));
        writeLocalePreference(nextPreference);
      },
      t: (key, values) => translate(locale, key, values),
      formatDateTime: (input, options) =>
        formatWithLocale(input, localeTag, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          ...options,
        }),
      formatTime: (input, options) =>
        formatWithLocale(input, localeTag, {
          hour: "2-digit",
          minute: "2-digit",
          ...options,
        }),
    };
  }, [initialLocale, locale, preference]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

