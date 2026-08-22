import { createFileRoute } from "@tanstack/react-router";
import { useAppSettings } from "@/lib/app-settings";
import { AppHeader, BottomNav } from "@/components/layout/BottomNav";
import { Card } from "@/components/ui/card";
import { Building2, Mail, MapPin, Phone } from "lucide-react";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  const { data: settings, logoUrl } = useAppSettings();

  return (
    <div className="pb-nav desktop:mx-auto desktop:max-w-[90rem]">
      <AppHeader title="Về chúng tôi" back />

      <div className="gradient-hero relative overflow-hidden px-5 py-8 text-white desktop:mx-6 desktop:rounded-3xl desktop:px-10 desktop:py-12">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
        <div className="relative flex flex-col items-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl bg-white/95 shadow-soft">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="logo-fit" />
            ) : (
              <Building2 className="h-9 w-9 text-primary" />
            )}
          </div>
          <h1 className="text-xl font-bold leading-tight">{settings.company_name}</h1>
          {settings.slogan && <p className="text-sm text-white/85">{settings.slogan}</p>}
        </div>
      </div>

      <div className="space-y-4 p-4 desktop:grid desktop:grid-cols-2 desktop:gap-6 desktop:space-y-0 desktop:px-6 desktop:py-6">
        {settings.about && (
          <Card className="rounded-2xl border-border/60 p-4 shadow-soft">
            <h2 className="mb-2 text-sm font-semibold">Giới thiệu</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {settings.about}
            </p>
          </Card>
        )}

        <Card className="rounded-2xl border-border/60 p-4 shadow-soft">
          <h2 className="mb-3 text-sm font-semibold">Thông tin liên hệ</h2>
          <div className="space-y-3 text-sm">
            {settings.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 text-foreground hover:text-primary"
              >
                <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                <span className="underline-offset-2 hover:underline">{settings.address}</span>
              </a>
            )}
            {settings.hotline && (
              <a
                href={`tel:${settings.hotline}`}
                className="flex items-center gap-3 text-foreground"
              >
                <Phone className="h-4 w-4 text-primary" />
                <span>{settings.hotline}</span>
              </a>
            )}
            {settings.email && (
              <a
                href={`mailto:${settings.email}`}
                className="flex items-center gap-3 text-foreground"
              >
                <Mail className="h-4 w-4 text-primary" />
                <span>{settings.email}</span>
              </a>
            )}
            {!settings.address && !settings.hotline && !settings.email && (
              <p className="text-muted-foreground">Chưa có thông tin liên hệ.</p>
            )}
          </div>
        </Card>
      </div>

      <BottomNav />
    </div>
  );
}
