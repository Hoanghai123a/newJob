import { useEffect, useState } from "react";
import { parseExcelToRowsFromUrl } from "@/lib/excel";
import { DataLoadingState } from "@/components/ui/data-loading-state";

export function ExcelPreview({ url, filename }: { url: string; filename: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    parseExcelToRowsFromUrl(url)
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3">
        <DataLoadingState variant="inline" label={`Đang tải ${filename}...`} />
      </div>
    );
  }

  if (error || !rows?.length) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Không thể đọc file {filename}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{filename}</div>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            {rows[0] && (
              <tr>
                {rows[0].map((cell, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.slice(1, 100).map((row, ri) => (
              <tr key={ri} className="border-b last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="whitespace-nowrap px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && (
          <div className="border-t bg-muted/30 px-2 py-1 text-center text-xs text-muted-foreground">
            Hiển thị 100/{rows.length - 1} dòng
          </div>
        )}
      </div>
    </div>
  );
}
