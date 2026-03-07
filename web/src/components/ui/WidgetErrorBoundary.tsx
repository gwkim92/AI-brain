"use client";

import React, { Component, type ReactNode } from "react";

import { useLocale } from "@/components/providers/LocaleProvider";

type WidgetErrorBoundaryProps = {
  widgetId: string;
  widgetTitle: string;
  children: ReactNode;
};

type LocalizedWidgetErrorBoundaryProps = WidgetErrorBoundaryProps & {
  crashLabel: string;
  unknownErrorLabel: string;
  retryLabel: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

class LocalizedWidgetErrorBoundary extends Component<LocalizedWidgetErrorBoundaryProps, State> {
  constructor(props: LocalizedWidgetErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[WidgetError] ${this.props.widgetId}:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-lg text-red-400">⚠</div>
          <p className="text-xs font-medium text-white/70">{this.props.crashLabel}</p>
          <p className="max-w-[200px] truncate text-[10px] text-white/40">
            {this.state.error?.message || this.props.unknownErrorLabel}
          </p>
          <button
            onClick={this.handleRetry}
            className="rounded bg-white/10 px-3 py-1 text-[10px] text-white/80 transition-colors hover:bg-white/20"
          >
            {this.props.retryLabel}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function WidgetErrorBoundary(props: WidgetErrorBoundaryProps) {
  const { t } = useLocale();

  return (
    <LocalizedWidgetErrorBoundary
      {...props}
      crashLabel={t("widgetError.title", { widgetTitle: props.widgetTitle })}
      unknownErrorLabel={t("widgetError.unknown")}
      retryLabel={t("widgetError.retry")}
    />
  );
}
