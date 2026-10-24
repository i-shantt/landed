"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EvalPage() {
  const runs = useQuery(api.evalRuns.list, {});
  const metrics = runs?.find((r) => r.scenarioId === "__metrics__");
  const rows = (runs ?? []).filter((r) => r.scenarioId !== "__metrics__");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Eval</h1>
        <p className="text-sm text-muted-foreground">Results posted by eval/runner.py. These are results on scripted cases; they do not establish effectiveness against real-world fraud.</p>
      </div>
      {runs === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <>
          {metrics && (
            <Card>
              <CardHeader>
                <CardTitle>Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(metrics.metrics ?? metrics.actual, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Actual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="font-mono text-sm">{r.scenarioId}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.passed ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"}>
                      {r.passed ? "pass" : "fail"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-xs break-all">{JSON.stringify(r.expected)}</TableCell>
                  <TableCell className="font-mono text-xs max-w-md break-all">{JSON.stringify(r.actual)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
