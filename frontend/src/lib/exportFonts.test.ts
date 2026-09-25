import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetExportFonts, loadExportFonts } from "./exportFonts";

function fontResponse(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), { status: 200 });
}

beforeEach(() => {
  _resetExportFonts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadExportFonts", () => {
  it("fetches both display faces once and returns them as woff2 data URIs", async () => {
    const fetchMock = vi.fn(async (path: string) =>
      fontResponse(path.includes("anton") ? [65, 66] : [67]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fonts = await loadExportFonts();
    expect(fonts).toEqual({
      anton: "data:font/woff2;base64,QUI=",
      secularOne: "data:font/woff2;base64,Qw==",
    });
    await loadExportFonts();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("/fonts/anton-latin.woff2");
    expect(fetchMock).toHaveBeenCalledWith("/fonts/secular-one-hebrew.woff2");
  });

  it("leaves out a face whose fetch fails or errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.includes("anton")) throw new Error("offline");
        return new Response(null, { status: 404 });
      }),
    );
    expect(await loadExportFonts()).toEqual({});
  });
});
