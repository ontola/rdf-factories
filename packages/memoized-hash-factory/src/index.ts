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
import { murmur3 } from "murmurhash-js";

export type AnyRDFObject = BlankNode | NamedNode | Literal | Quad | Quadruple;

type SomeNode = BlankNode | NamedNode;

interface MemoizedHashFactoryInternals {
  memoizationMap: { [k: string]: AnyRDFObject };
  seedBase: number;
}

export interface DataFactoryArgs {
  bnIndex?: number;
  memoizationMap?: {};
  seedBase?: number;
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
  /**
   * The seed  is used as a modifiable base index.
   * We increase the number with a fixed amount per term type to generate different hashes for terms with the same
   * value but a different termType.
   */
  public seedBase: number;
  public memoizationMap: { [k: string]: BlankNode | NamedNode | Literal | Quad };

  private readonly base: any;

  constructor(opts: DataFactoryArgs = {}) {
    super({ supports: MemoizedHashFactory.FactorySupport, ...opts });

    this.bnIndex = opts.bnIndex || 0;
    this.memoizationMap = opts.memoizationMap || {};
    this.seedBase = opts.seedBase || 0;
    this.base = rdfBase(this);
  }

  public blankNode(value?: string): BlankNode {
    if (value && typeof value !== "string") {
      throw createException('BlankNode', value)
    }
    const usedValue = value || `b${++this.bnIndex}`;
    const id = this.id({ termType: "BlankNode", value: usedValue });
    if (this.memoizationMap[id]) {
      return this.memoizationMap[id] as BlankNode;
    }
    const term = Object.create(this.base);
    term.termType = TermType.BlankNode;
    term.value = usedValue;
    term.id = id;

    this.memoizationMap[id] = term;

    return term;
  }

  public namedNode(value: string): NamedNode {
    if (typeof value !== "string") {
      throw createException('NamedNode', value)
    }
    const id = this.id({ termType: "NamedNode", value });
    if (this.memoizationMap[id]) {
      return this.memoizationMap[id] as NamedNode;
    }
    const term = Object.create(this.base);
    term.termType = TermType.NamedNode;
    term.value = value;
    term.id = id;

    this.memoizationMap[id] = term;

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

    const id = this.id({ termType: "Literal", value, datatype, language  });
    if (this.memoizationMap[id]) {
      return this.memoizationMap[id] as Literal;
    }

    const term = Object.create(this.base);
    term.termType = TermType.Literal;
    term.datatype = datatype;
    term.language = language;
    term.value = value;
    term.id = id;

    this.memoizationMap[id] = term;

    return term;
  }

  public quad(
    subject: NamedNode | BlankNode,
    predicate: NamedNode,
    object: BlankNode | NamedNode | Literal,
    graph?: SomeNode,
  ): Quad {
    const usedGraph = graph || this.defaultGraph();
    const id = murmur3(
      (
        this.id(subject)
        + this.id(predicate)
        + this.id(object)
        + this.id(usedGraph)
      ).toString(),
      this.seedBase + 3,
    );
    if (this.memoizationMap[id]) {
      return this.memoizationMap[id] as Quad;
    }

    const quad = Object.create(rdflibQuadPatch);
    quad.id = id;
    quad.subject = subject;
    quad.predicate = predicate;
    quad.object = object;
    quad.graph = usedGraph;

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

  public fromId(id: Indexable): BlankNode | NamedNode | Literal | Quad {
    return this.memoizationMap[id];
  }

  public id(term: AnyRDFObject): number {
    if (Array.isArray(term) || typeof term === "undefined") {
      return -1;
    }
    if ((term as any).id) {
      return (term as any).id;
    }

    if (this.isQuad(term)) {
      return murmur3(
        (
          this.id(term.subject)
          + this.id(term.predicate)
          + this.id(term.object)
          + (term.graph ? this.id(term.graph) : 0)
        ).toString(),
        this.seedBase + 3,
      );
    }

    switch (term.termType) {
      case TermType.BlankNode:
        return murmur3(term.value, this.seedBase + 1);
      case TermType.NamedNode:
        return murmur3(term.value, this.seedBase + 2);
      case TermType.Literal: {
        const langOrDTId = term.language
          ? murmur3(term.language, this.seedBase)
          : this.id(term.datatype);

        return murmur3(term.value, this.seedBase + 4 + langOrDTId);
      }
      default:
        return -1;
    }
  }
}

export default new MemoizedHashFactory();
