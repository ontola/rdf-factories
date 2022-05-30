import {
  BlankNode,
  Comparable,
  DataFactory,
  Feature,
  Indexable,
  Literal,
  NamedNode,
  PlainFactory,
  Quad,
  Quadruple,
  TermType,
} from "@ontologies/core";

export type AnyRDFObject = BlankNode | NamedNode | Literal | Quad | Quadruple;

type SomeNode = BlankNode | NamedNode;

interface MemoizedHashFactoryInternals {
  memoizationMap: { [k: string]: AnyRDFObject };
}

export interface DataFactoryArgs {
  bnIndex?: number;
}

const rdflibQuadPatch = {
  get why(): SomeNode {
    return (this as any).graph;
  },
};

const rdfBase = (factory: DataFactory): any => ({
  equals(other: Comparable): boolean {
    return factory.equals.call(factory, this as any, other);
  },

  /* rdflib compat */

  /** @deprecated */
  toCanonical(): any {
    return this;
  },

  /** @deprecated */
  toNT(): string {
    return factory.toNQ(this);
  },

  /** @deprecated */
  toString() {
    return factory.toNQ(this);
  },

  /** @deprecated */
  get uri(): string {
    return this.value;
  },

  /** @deprecated */
  set uri(uri: string) {
    this.value = uri;
  },
});

const datatypes = {
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  dateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  double: "http://www.w3.org/2001/XMLSchema#double",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  langString: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
  string: "http://www.w3.org/2001/XMLSchema#string",
};

function createException(type: string, value: any) {
  const valueType = (value && typeof value === "object") ? value.constructor : typeof value;
  return new TypeError(`Value of ${type} has to be type string, was value '${value}' of type '${valueType}'`)
}

/**
 * RDF DataFactory which stores every value once at most.
 *
 * This version uses hashing which might be more CPU consuming but has deterministic id creation.
 */
export class MemoizedHashFactory extends PlainFactory implements DataFactory<AnyRDFObject>, MemoizedHashFactoryInternals {
  public static FactorySupport = {
    [Feature.collections]: false,
    [Feature.defaultGraphType]: false,
    [Feature.equalsMethod]: false,
    [Feature.id]: true,
    [Feature.idStamp]: true,
    [Feature.identity]: true,
    [Feature.reversibleId]: true,
    [Feature.variableType]: false,
  };

  public bnIndex: number;

  public memoizationMap: { [k: string]: BlankNode | NamedNode | Literal | Quadruple } = {};
  public blankNodeMap: { [k: string]: BlankNode } = {};
  public namedNodeMap: { [k: string]: NamedNode } = {};
  public literalMap: { [k: string]: Literal } = {};
  public quadMap: { [k: string]: Quad } = {};

  private readonly base: any;
  private index = 1;

  constructor(opts: DataFactoryArgs = {}) {
    super({ supports: MemoizedHashFactory.FactorySupport, ...opts });

    this.bnIndex = opts.bnIndex || 1;
    this.base = rdfBase(this);
  }

  public blankNode(value?: string): BlankNode {
    if (value && typeof value !== "string") {
      throw createException("BlankNode", value)
    }
    const usedValue = value || `_:b${++this.bnIndex}`;
    const mapId = this.mapId({ termType: "BlankNode", value: usedValue });
    if (mapId && this.blankNodeMap[mapId]) {
      return this.blankNodeMap[mapId] as BlankNode;
    }
    const term = Object.create(this.base);
    term.termType = TermType.BlankNode;
    term.value = usedValue;
    term.id = this.index++;

    this.blankNodeMap[mapId] = term;
    this.memoizationMap[term.id] = term;

    return term;
  }

  public namedNode(value: string): NamedNode {
    if (typeof value !== "string") {
      throw createException("NamedNode", value)
    }
    const mapId = this.mapId({ termType: "NamedNode", value });
    if (this.namedNodeMap[mapId]) {
      return this.namedNodeMap[mapId] as NamedNode;
    }
    const term = Object.create(this.base);
    term.termType = TermType.NamedNode;
    term.value = value;
    term.id = this.index++;

    this.namedNodeMap[mapId] = term;
    this.memoizationMap[term.id] = term;

    return term;
  }

  public defaultGraph(): NamedNode {
    return this.namedNode("rdf:defaultGraph");
  }

  public literal(value: string | unknown, languageOrDatatype?: string | NamedNode): Literal {
    if (typeof value !== "string") {
      return this.parseLiteral(value);
    }

    const isLangString = typeof languageOrDatatype === "string";
    const datatype = isLangString
      ? this.namedNode(datatypes.langString)
      : (languageOrDatatype as NamedNode || this.namedNode(datatypes.string));
    if (datatype === undefined) {
      throw Error("datatype must be defined");
    }
    const language = isLangString ? (languageOrDatatype as string || "") : "";

    const mapId = this.mapId({ termType: "Literal", value, datatype, language  });
    if (this.literalMap[mapId]) {
      return this.literalMap[mapId] as Literal;
    }

    const term = Object.create(this.base);
    term.termType = TermType.Literal;
    term.datatype = datatype;
    term.language = language;
    term.value = value;
    term.id = this.index++;

    this.literalMap[mapId] = term;
    this.memoizationMap[term.id] = term;

    return term;
  }

  public quad(
    subject: NamedNode | BlankNode,
    predicate: NamedNode,
    object: BlankNode | NamedNode | Literal,
    graph?: SomeNode,
  ): Quad {
    const usedGraph = graph || this.defaultGraph();
    const quadMapId = `${this.id(subject)},${this.id(predicate)},${this.id(object)},${(graph ? this.id(graph) : 0)}`;
    if (this.quadMap[quadMapId]) {
      return this.quadMap[quadMapId] as Quad;
    }

    const quad = Object.create(rdflibQuadPatch);
    quad.id = this.index++;
    quad.subject = subject;
    quad.predicate = predicate;
    quad.object = object;
    quad.graph = usedGraph;

    this.quadMap[quadMapId] = quad;
    this.memoizationMap[quad.id] = quad;

    return quad;
  }

  public equals(
    a: Comparable,
    b: Comparable,
  ): boolean {
    if (!a || !b) {
      return a === b;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      return this.id(a[0]) === this.id(b[0])
        && this.id(a[1]) === this.id(b[1])
        && this.id(a[2]) === this.id(b[2])
        && this.id(a[3]) === this.id(b[3]);
    }

    return this.id(a) === this.id(b);
  }

  public fromId(id: Indexable): BlankNode | NamedNode | Literal | Quad | Quadruple {
    return this.memoizationMap[id];
  }

  public id(term: AnyRDFObject): number {
    if (Array.isArray(term) || typeof term === "undefined") {
      return -1;
    }
    if ((term as any).id) {
      return (term as any).id;
    }

    const mapId = this.mapId(term);

    if (this.isQuad(term)) {
      const mapValue = this.quadMap[mapId];

      return mapValue ? mapValue.id as number : this.index++;
    }

    switch (term.termType) {
      case TermType.BlankNode: {
        const mapValue = this.blankNodeMap[mapId];
        return mapValue ? mapValue.id as number : this.index++;
      }
      case TermType.NamedNode: {
        const mapValue = this.namedNodeMap[mapId];
        return mapValue ? mapValue.id as number : this.index++;
      }
      case TermType.Literal: {
        const mapValue = this.literalMap[mapId];
        return mapValue ? mapValue.id as number : this.index++;
      }
      default:
        return -1;
    }
  }

  private mapId(term: BlankNode | NamedNode | Literal | Quad): string | undefined {
    if (this.isQuad(term)) {
      return `${this.id(term.subject)},${this.id(term.predicate)},${this.id(term.object)},${(term.graph ? this.id(term.graph) : 0)}`;
    }

    switch (term.termType) {
      case TermType.BlankNode:
      case TermType.NamedNode:
        return term.value;
      case TermType.Literal: {
        return `${term.value},${term.language},${term.datatype.value}`
      }
      default:
        return undefined;
    }
  }
}

export default new MemoizedHashFactory();
