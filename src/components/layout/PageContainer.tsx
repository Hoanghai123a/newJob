import { ReactNode } from "react";
import { AppHeader, BottomNav } from "@/components/layout/BottomNav";
import { cn } from "@/lib/utils";

export type MobilePageScaffoldProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
  children: ReactNode;
  showNavigation?: boolean;
  className?: string;
  desktopWidth?: "default" | "wide" | "full";
  bottomAction?: ReactNode;
};

export function MobilePageScaffold({
  title,
  subtitle,
  right,
  back = true,
  children,
  showNavigation = false,
  className,
  desktopWidth = "default",
  bottomAction,
}: MobilePageScaffoldProps) {
  const desktopWidthClass = {
    default: "desktop:max-w-[90rem]",
    wide: "desktop:max-w-[110rem]",
    full: "desktop:max-w-none",
  }[desktopWidth];

  return (
    <div className={cn(bottomAction ? "page-action-shell" : "pb-nav")}>
      <AppHeader title={title} subtitle={subtitle} right={right} back={back} />
      <main
        className={cn(
          "mobile-page space-y-4 px-4 pt-4 desktop:mx-auto desktop:w-full desktop:px-8 desktop:pt-6",
          bottomAction && "page-action-main",
          desktopWidthClass,
          className,
        )}
      >
        {children}
      </main>
      {bottomAction && <div className="sticky-form-actions">{bottomAction}</div>}
      {showNavigation && <BottomNav />}
    </div>
  );
}

export function PageContainer(props: MobilePageScaffoldProps & { showNav?: boolean }) {
  const { showNav, ...rest } = props;
  return <MobilePageScaffold {...rest} showNavigation={showNav} />;
}
