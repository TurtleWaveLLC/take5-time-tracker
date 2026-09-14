/**
 * Tests for the shared blob-URL module (jsdom has no createObjectURL, so the
 * URL statics are stubbed).
 */

import { mintJsonUrl, releaseUrl } from "./blobUrl";

describe("blobUrl", () => {
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();

  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
  });

  beforeEach(() => {
    createObjectURL.mockReset().mockReturnValue("blob:mock-url");
    revokeObjectURL.mockReset();
  });

  it("mints a URL from a JSON blob with the right MIME type", () => {
    const url = mintJsonUrl('{"a":1}');

    expect(url).toBe("blob:mock-url");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json");
  });

  it("releases by revoking the given URL", () => {
    releaseUrl("blob:mock-url");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
