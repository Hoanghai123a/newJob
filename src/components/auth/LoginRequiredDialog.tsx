import { useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LoginRequiredDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-3xl p-0 sm:rounded-3xl">
        <DialogHeader className="gradient-primary rounded-t-3xl px-6 pb-5 pt-6 text-primary-foreground">
          <DialogTitle className="text-xl">Đăng nhập quản trị</DialogTitle>
          <DialogDescription className="text-primary-foreground/80">
            Chức năng này chỉ dành cho tài khoản quản trị và nhân sự.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-muted-foreground">
            Vui lòng đăng nhập bằng mã công ty tại trang đăng nhập chính.
          </p>
          <Button
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate({ to: "/login" });
            }}
          >
            <LogIn />
            Đến trang đăng nhập
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
