import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * @remarks a thrown render in one tab must not blank the whole app; this shows the tab's failure in
 * place and leaves the header and the other tabs usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("tab render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return <div className="state">This view ran into a problem: {this.state.message}</div>;
    }
    return this.props.children;
  }
}
