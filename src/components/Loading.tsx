export function Loading({ message }: { message: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>{message}</p>
    </div>
  );
}
