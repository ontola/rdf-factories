# `@ontola/memoized-factory`

[RDFJS compatible data factory](http://rdf.js.org/data-model-spec/) which implements memoization
based on the term's value and incrementing counters. Once a term is created the same instance will
be returned for future requests.

This saves memory and allows comparison by reference (`===`) which is great for browsers on mobile
devices, but can cause out of memory exceptions for long running processes since the current
implementation will always hold a strong reference to the created objects (I.e. they can't be
garbage collected).

See [@ontologies/core](https://npmjs.com/package/@ontologies/core) for more info on usage.

## Usage
Put the following in a file;

```javascript
/* useMemoizedHashFactory.js */
import singletonInstance from "@ontola/memoized-factory";
import { setup } from "@ontologies/core";

setup(singletonInstance)
```

It is important to import the code which calls `setup` before importing any of the
`@ontologies/package` helpers, since their exports use the factory which you pass to `setup`;

```javascript
// This must be done first
import "./useMemoizedFactory"

// This import will use the factory you passed to `setup`.
import schema from "@ontologies/schema"
```
