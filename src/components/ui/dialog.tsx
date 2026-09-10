import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  flattenOverlayChildren,
  isOverlayElement,
  splitOverlayChildren,
} from "@/components/ui/overlay-layout";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 desktop:duration-150 desktop:ease-out",
      className,
    )}
    {...props}
    ref={ref}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const hasDialogDescription = (children: React.ReactNode): boolean => {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return false;
    if (child.type === DialogDescription) return true;
    return hasDialogDescription(child.props.children);
  });
};

type DialogLayout = "auto" | "raw";

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  layout?: DialogLayout;
  bodyClassName?: string;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, overlayClassName, layout = "auto", bodyClassName, ...props }, ref) => {
  const descriptionId = React.useId();
  const hasDescription = hasDialogDescription(children);
  const parts = splitOverlayChildren(children, {
    header: DialogHeader,
    body: DialogBody,
    footer: DialogFooter,
  });
  const isStructured = layout === "auto" && (parts.header.length > 0 || parts.footer.length > 0);

  const renderBody = (bodyChildren: React.ReactNode) => (
    <DialogBody key="dialog-body" className={bodyClassName}>
      {bodyChildren}
    </DialogBody>
  );

  let content = children;
  if (isStructured) {
    const formNode = parts.body.length === 1 ? parts.body[0] : null;
    const formElement =
      React.isValidElement<React.FormHTMLAttributes<HTMLFormElement>>(formNode) &&
      formNode.type === "form"
        ? formNode
        : null;
    const formChildren = formElement ? flattenOverlayChildren(formElement.props.children) : [];
    const nestedFooter = formChildren.filter((child) => isOverlayElement(child, DialogFooter));

    if (formElement && nestedFooter.length > 0) {
      const formBody = formChildren.filter((child) => !isOverlayElement(child, DialogFooter));
      const formProps = formElement.props;
      const normalizedForm = React.cloneElement(formElement, {
        className: cn(
          formProps.className,
          "flex min-h-0 flex-1 flex-col overflow-hidden space-y-0",
        ),
        children: (
          <>
            {renderBody(formBody)}
            {nestedFooter}
          </>
        ),
      });

      content = [...parts.header, normalizedForm, ...parts.footer];
    } else {
      const bodyContent = parts.hasExplicitBody ? parts.body : renderBody(parts.body);
      content = [...parts.header, bodyContent, ...parts.footer];
    }
  }

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        {...props}
        aria-describedby={props["aria-describedby"] ?? (hasDescription ? undefined : descriptionId)}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 max-h-[88dvh] w-[calc(100%-2rem)] max-w-[26rem] translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-border/70 bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 desktop:duration-150 desktop:ease-out desktop:max-w-3xl",
          layout === "raw"
            ? "grid gap-4 overflow-y-auto p-5"
            : isStructured
              ? "flex flex-col gap-0 overflow-hidden p-0"
              : "grid gap-4 overflow-y-auto p-5",
          className,
          isStructured && "flex flex-col gap-0 overflow-hidden p-0",
        )}
      >
        {!hasDescription ? (
          <DialogDescription id={descriptionId} className="sr-only">
            Nội dung hộp thoại.
          </DialogDescription>
        ) : null}
        {content}
        <DialogPrimitive.Close className="absolute right-3 top-3 z-20 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-90 ring-offset-background transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Đóng</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "relative z-10 flex shrink-0 flex-col space-y-1.5 border-b border-border/60 bg-background px-5 py-4 pr-14 text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", className)}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "relative z-10 flex shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-background px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:space-x-2 sm:pb-4",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-6 tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-5 text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
