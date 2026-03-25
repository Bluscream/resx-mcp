import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { Parser, Builder } from "xml2js";

const HEADER_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <xsd:schema id="root" xmlns="" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">
    <xsd:import namespace="http://www.w3.org/XML/1998/namespace" />
    <xsd:element name="root" msdata:IsDataSet="true">
      <xsd:complexType>
        <xsd:choice maxOccurs="unbounded">
          <xsd:element name="metadata">
            <xsd:complexType>
              <xsd:sequence>
                <xsd:element name="value" type="xsd:string" minOccurs="0" />
              </xsd:sequence>
              <xsd:attribute name="name" use="required" type="xsd:string" />
              <xsd:attribute name="type" type="xsd:string" />
              <xsd:attribute name="mimetype" type="xsd:string" />
              <xsd:attribute ref="xml:space" />
            </xsd:complexType>
          </xsd:element>
          <xsd:element name="assembly">
            <xsd:complexType>
              <xsd:attribute name="alias" type="xsd:string" />
              <xsd:attribute name="name" type="xsd:string" />
            </xsd:complexType>
          </xsd:element>
          <xsd:element name="data">
            <xsd:complexType>
              <xsd:sequence>
                <xsd:element name="value" type="xsd:string" minOccurs="0" msdata:Ordinal="1" />
                <xsd:element name="comment" type="xsd:string" minOccurs="0" msdata:Ordinal="2" />
              </xsd:sequence>
              <xsd:attribute name="name" type="xsd:string" use="required" msdata:Ordinal="1" />
              <xsd:attribute name="type" type="xsd:string" msdata:Ordinal="3" />
              <xsd:attribute name="mimetype" type="xsd:string" msdata:Ordinal="4" />
              <xsd:attribute ref="xml:space" />
            </xsd:complexType>
          </xsd:element>
          <xsd:element name="resheader">
            <xsd:complexType>
              <xsd:sequence>
                <xsd:element name="value" type="xsd:string" minOccurs="0" msdata:Ordinal="1" />
              </xsd:sequence>
              <xsd:attribute name="name" type="xsd:string" use="required" />
            </xsd:complexType>
          </xsd:element>
        </xsd:choice>
      </xsd:complexType>
    </xsd:element>
  </xsd:schema>
  <resheader name="resmimetype">
    <value>text/microsoft-resx</value>
  </resheader>
  <resheader name="version">
    <value>2.0</value>
  </resheader>
  <resheader name="reader">
    <value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>
  </resheader>
  <resheader name="writer">
    <value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>
  </resheader>
</root>`;

const isSingleMode = process.argv.includes("--single-tool") || process.argv.includes("-single");

const server = new Server(
  {
    name: "resx-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

async function readResx(filePath: string) {
  const content = await fs.readFile(filePath, "utf-8");
  const parser = new Parser();
  return await parser.parseStringPromise(content);
}

async function writeResx(filePath: string, resxObj: any) {
  const builder = new Builder();
  const xml = builder.buildObject(resxObj);
  await fs.writeFile(filePath, xml, "utf-8");
}

const TOOLS: Record<string, any> = {
  read_resx_file: {
    description: "Lists all entries in a .resx file with their types and mimetypes.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args: any) => {
      const { path: filePath } = z.object({ path: z.string() }).parse(args);
      const resx = await readResx(filePath);
      const data = resx.root.data || [];
      const entries = data.map((d: any) => ({
        name: d.$.name,
        type: d.$.type,
        mimetype: d.$.mimetype,
        comment: d.comment?.[0],
        hasValue: !!d.value?.[0],
      }));
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  },
  read_resx_entry: {
    description: "Gets a specific entry from a .resx file. Can extract binary data to a file or return it as encoded string.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        key: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "hex", "base64"], default: "utf8" },
        target_file: { type: "string", description: "Path to save binary data if the entry is binary." },
      },
      required: ["path", "key"],
    },
    handler: async (args: any) => {
      const { path: filePath, key, encoding, target_file } = z.object({
        path: z.string(),
        key: z.string(),
        encoding: z.enum(["utf8", "hex", "base64"]).optional().default("utf8"),
        target_file: z.string().optional(),
      }).parse(args);

      const resx = await readResx(filePath);
      const entry = (resx.root.data || []).find((d: any) => d.$.name === key);

      if (!entry) throw new Error(`Entry '${key}' not found in ${filePath}`);

      let value = entry.value?.[0] || "";
      const mimetype = entry.$.mimetype;
      const type = entry.$.type;

      if (mimetype && mimetype.includes("base64")) {
        const buffer = Buffer.from(value.trim(), "base64");
        if (target_file) {
          await fs.writeFile(target_file, buffer);
          return { content: [{ type: "text", text: `Binary data extracted to ${target_file}` }] };
        }
        if (encoding === "hex") value = buffer.toString("hex");
        else if (encoding === "base64") value = buffer.toString("base64");
        else value = buffer.toString("utf8");
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ key, value, type, mimetype, comment: entry.comment?.[0] }, null, 2)
        }]
      };
    }
  },
  write_resx_entry: {
    description: "Adds or updates an entry in a .resx file. Supports string and binary data (via hex, base64 or source file).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
        hexValue: { type: "string" },
        source_file: { type: "string", description: "Path to a file to embed as binary data." },
        comment: { type: "string" },
        type: { type: "string" },
        mimetype: { type: "string" },
      },
      required: ["path", "key"],
    },
    handler: async (args: any) => {
      const params = z.object({
        path: z.string(),
        key: z.string(),
        value: z.string().optional(),
        hexValue: z.string().optional(),
        source_file: z.string().optional(),
        comment: z.string().optional(),
        type: z.string().optional(),
        mimetype: z.string().optional(),
      }).parse(args);

      let resx = await readResx(params.path);
      if (!resx.root.data) resx.root.data = [];

      let entryIdx = resx.root.data.findIndex((d: any) => d.$.name === params.key);
      let finalValue = params.value || "";
      let finalType = params.type;
      let finalMime = params.mimetype;

      if (params.source_file) {
        const buffer = await fs.readFile(params.source_file);
        finalValue = buffer.toString("base64");
        finalType = finalType || "System.Byte[], mscorlib";
        finalMime = finalMime || "application/x-microsoft.net.object.bytearray.base64";
      } else if (params.hexValue) {
        const buffer = Buffer.from(params.hexValue, "hex");
        finalValue = buffer.toString("base64");
        finalType = finalType || "System.Byte[], mscorlib";
        finalMime = finalMime || "application/x-microsoft.net.object.bytearray.base64";
      }

      const newEntry: any = { $: { name: params.key }, value: [finalValue] };
      if (finalType) newEntry.$.type = finalType;
      if (finalMime) newEntry.$.mimetype = finalMime;
      if (params.comment) newEntry.comment = [params.comment];

      if (entryIdx >= 0) resx.root.data[entryIdx] = newEntry;
      else resx.root.data.push(newEntry);

      await writeResx(params.path, resx);
      return { content: [{ type: "text", text: `Successfully wrote entry '${params.key}' to ${params.path}` }] };
    }
  },
  delete_resx_entry: {
    description: "Deletes an entry from a .resx file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, key: { type: "string" } },
      required: ["path", "key"],
    },
    handler: async (args: any) => {
      const { path: filePath, key } = z.object({ path: z.string(), key: z.string() }).parse(args);
      const resx = await readResx(filePath);
      if (!resx.root.data) return { content: [{ type: "text", text: `Entry '${key}' not found.` }] };
      const initialLen = resx.root.data.length;
      resx.root.data = resx.root.data.filter((d: any) => d.$.name !== key);
      if (resx.root.data.length === initialLen) return { content: [{ type: "text", text: `Entry '${key}' not found.` }] };
      await writeResx(filePath, resx);
      return { content: [{ type: "text", text: `Successfully deleted entry '${key}' from ${filePath}` }] };
    }
  },
  create_resx_file: {
    description: "Creates a new .resx file with standard headers.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args: any) => {
      const { path: filePath } = z.object({ path: z.string() }).parse(args);
      await fs.writeFile(filePath, HEADER_TEMPLATE, "utf-8");
      return { content: [{ type: "text", text: `Successfully created .resx file at ${filePath}` }] };
    }
  },
  test_resx_file: {
    description: "Validates a .resx file for validity.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    handler: async (args: any) => {
      const { path: filePath } = z.object({ path: z.string() }).parse(args);
      try {
        const resx = await readResx(filePath);
        if (!resx.root) throw new Error("Missing root element");
        if (!resx.root.resheader) throw new Error("Missing resheader elements");
        return { content: [{ type: "text", text: `File ${filePath} is a valid .resx file.` }] };
      } catch (e: any) {
        throw new Error(`Invalid .resx file: ${e.message}`);
      }
    }
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (isSingleMode) {
    return {
      tools: [
        {
          name: "resx",
          description: "Universal resx tool for managing resources. Specify sub-tool via the 'tool' argument.",
          inputSchema: {
            type: "object",
            properties: {
              tool: { type: "string", enum: Object.keys(TOOLS), description: "Sub-tool to call." },
              args: { type: "object", description: "Arguments for the sub-tool." }
            },
            required: ["tool", "args"],
          },
        },
      ],
    };
  }

  return {
    tools: Object.entries(TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (isSingleMode && name === "resx") {
      const { tool: subTool, args: subArgs } = z.object({
        tool: z.string(),
        args: z.any(),
      }).parse(args);

      if (!TOOLS[subTool]) throw new Error(`Unknown sub-tool: ${subTool}`);
      return await TOOLS[subTool].handler(subArgs);
    }

    if (TOOLS[name]) {
      return await TOOLS[name].handler(args);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Resx MCP server running on stdio (Single mode: ${isSingleMode})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
