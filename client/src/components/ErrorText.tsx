import { Icon } from "../art/icons";

/** An inline error that screen readers announce. Renders an empty live region when there is none. */
export function ErrorText({ error, id }: { error: string | null | undefined; id?: string }) {
  return (
    <p id={id} className="error-text" role="alert">
      {error ? (
        <>
          <Icon name="warn" size={16} />
          {error}
        </>
      ) : null}
    </p>
  );
}
