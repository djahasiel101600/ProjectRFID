import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="text-red-500 text-5xl mb-4">⚠️</div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Something went wrong
              </h2>
              <p className="text-gray-500 text-sm">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <Button onClick={this.handleRetry}>Try Again</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
