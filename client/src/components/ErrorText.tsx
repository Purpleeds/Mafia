/** An inline error that screen readers announce. Renders an empty live region when there is none. */
export function ErrorText({ error, id }: { error: string | null | undefined; id?: string }) {
  return (
    <p id={id} className="error-text" role="alert">
      {error ? (
        <>
          <span aria-hidden="true">⚠ </span>
          {error}
        </>
      ) : null}
    </p>
  );
}
