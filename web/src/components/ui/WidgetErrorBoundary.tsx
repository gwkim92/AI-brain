"use client";

import React, { Component, type ReactNode } from "react";

type Props = {
  widgetId: string;
  widgetTitle: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
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
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <div className="text-red-400 text-lg">⚠</div>
          <p className="text-xs text-white/70 font-medium">
            {this.props.widgetTitle} crashed
          </p>
          <p className="text-[10px] text-white/40 max-w-[200px] truncate">
            {this.state.error?.message || "Unknown error"}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1 text-[10px] rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
