let isInstalled = false;

function isHtmlForm(element: EventTarget | null): element is HTMLFormElement {
  return element instanceof HTMLFormElement;
}

function shouldAllowNativeSubmit(form: HTMLFormElement): boolean {
  if (form.dataset.nativeSubmit === "true") return true;
  if (form.dataset.allowNativeSubmit === "true") return true;

  const action = form.getAttribute("action")?.trim();
  return Boolean(action);
}

export function installSpaFormSubmitGuard(): void {
  if (isInstalled || typeof document === "undefined") return;
  isInstalled = true;

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!isHtmlForm(form)) return;
      if (shouldAllowNativeSubmit(form)) return;

      event.preventDefault();
    },
    true,
  );
}
