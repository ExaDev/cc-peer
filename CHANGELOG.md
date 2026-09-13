## [1.3.1](https://github.com/ExaDev/cc-peer/compare/v1.3.0...v1.3.1) (2026-09-13)

## [1.3.0](https://github.com/ExaDev/cc-peer/compare/v1.2.8...v1.3.0) (2026-09-13)

### Features

* **release:** commit the version bump and changelog back to main ([786ac48](https://github.com/ExaDev/cc-peer/commit/786ac4875494bcc435c17b16880db82c533cbb11))

## [1.2.8](https://github.com/ExaDev/cc-peer/compare/v1.2.7...v1.2.8) (2026-09-13)

### Bug Fixes

* **sea:** drop Intel macOS from the release matrix, an unsupported Node SEA platform ([9cccdde](https://github.com/ExaDev/cc-peer/commit/9cccddeb6b0e27c1ebce7533978742c84973a496)), references [nodejs/node#62893](https://github.com/nodejs/node/issues/62893)

## [1.2.7](https://github.com/ExaDev/cc-peer/compare/v1.2.6...v1.2.7) (2026-09-13)

### Bug Fixes

* **test:** stop the sea e2e test's own timeout race from swallowing diagnostics ([b2e95d8](https://github.com/ExaDev/cc-peer/commit/b2e95d87acc3ef2bc92cb1993c7d2609f4b34e42))

## [1.2.6](https://github.com/ExaDev/cc-peer/compare/v1.2.5...v1.2.6) (2026-09-13)

### Bug Fixes

* **test:** give the SEA binary e2e test its own, larger startup budget ([71233f9](https://github.com/ExaDev/cc-peer/commit/71233f98f577adbba0e5b2dd7f9cb19373da1581))

## [1.2.5](https://github.com/ExaDev/cc-peer/compare/v1.2.4...v1.2.5) (2026-09-13)

### Bug Fixes

* **ci:** replace the retired macos-13 runner label with macos-latest-large ([cbc8b43](https://github.com/ExaDev/cc-peer/commit/cbc8b43d1d1c9fec0375656f7118c9a4b9192b51))
* **ci:** use macos-26-intel instead of macos-latest-large ([20a5950](https://github.com/ExaDev/cc-peer/commit/20a595079fac1fc211cdd9512536a261b595d511))

## [1.2.4](https://github.com/ExaDev/cc-peer/compare/v1.2.3...v1.2.4) (2026-09-13)

## [1.2.3](https://github.com/ExaDev/cc-peer/compare/v1.2.2...v1.2.3) (2026-09-13)

### Bug Fixes

* **ci:** run the release-asset upload retry under bash explicitly ([e7d4329](https://github.com/ExaDev/cc-peer/commit/e7d4329da8f058de27d4df22e77be83472504a3c))

## [1.2.2](https://github.com/ExaDev/cc-peer/compare/v1.2.1...v1.2.2) (2026-09-13)

### Bug Fixes

* **ci:** retry the SEA release-asset upload against a just-created release ([90d1b8d](https://github.com/ExaDev/cc-peer/commit/90d1b8ddd861697d4ab620013d817d4c314fcf91))

## [1.2.1](https://github.com/ExaDev/cc-peer/compare/v1.2.0...v1.2.1) (2026-09-13)

### Bug Fixes

* **ci:** poll for the SEA smoke banner instead of a fixed 5-second sleep ([5e406e5](https://github.com/ExaDev/cc-peer/commit/5e406e55eee69446d4587e96985f0c8ddf4b13a7))
* **ci:** stamp the resolved release version onto the GitHub Packages mirror ([5b4c0c9](https://github.com/ExaDev/cc-peer/commit/5b4c0c9a8e0809dc50a0fc98eb5b3705447de0b3))

## [1.2.0](https://github.com/ExaDev/cc-peer/compare/v1.1.9...v1.2.0) (2026-09-13)

### Features

* **windows:** support native Windows via a per-pid named pipe ([1dcbef7](https://github.com/ExaDev/cc-peer/commit/1dcbef75b71acd15322de1588420fccdfc7d260f)), references [nodejs/node#55979](https://github.com/nodejs/node/issues/55979)

### Bug Fixes

* **test:** allow real subprocess-spawning tests more time on Windows ARM ([8e75f3a](https://github.com/ExaDev/cc-peer/commit/8e75f3a0eed783563fbc7616675d8ddbaf67b631))
* **test:** give sweepSpool's batch-cap test headroom for its own I/O volume ([193e18f](https://github.com/ExaDev/cc-peer/commit/193e18f289e5f8cf32697735fdb0b96a8a8ef313))
* **test:** skip POSIX-only file-permission assertions on Windows ([f8190bb](https://github.com/ExaDev/cc-peer/commit/f8190bba25fbb5dd9c2f67c3f254d375501379e6))
* **test:** stop asserting POSIX-only behaviour and paths on real Windows ([795ed0e](https://github.com/ExaDev/cc-peer/commit/795ed0e85ac4305972418d4d1016c83d4c872547))
* **windows:** namespace named-pipe paths by socketDir instead of a filesystem path ([a0a5a44](https://github.com/ExaDev/cc-peer/commit/a0a5a445d9690a9abf29a0d802da60a4a787c591))
* **windows:** recognise a drive-letter-rooted path as absolute in file-transfer validation ([c77d8cc](https://github.com/ExaDev/cc-peer/commit/c77d8cc437300c3ccdd6a0ab18ab11ed1b7697c6))

## [1.1.9](https://github.com/ExaDev/cc-peer/compare/v1.1.8...v1.1.9) (2026-09-13)

### Bug Fixes

* **sea:** drop windows from the release matrix, a real platform incompatibility ([ee90b2a](https://github.com/ExaDev/cc-peer/commit/ee90b2a00720ffd9071533b5607d0c7ce0585b0f)), references [nodejs/node#55979](https://github.com/nodejs/node/issues/55979) [nodejs/node#35008](https://github.com/nodejs/node/issues/35008)

## [1.1.8](https://github.com/ExaDev/cc-peer/compare/v1.1.7...v1.1.8) (2026-09-13)

### Bug Fixes

* **ci:** run windows sea steps under bash and disable provenance on the mirror ([2c9fde0](https://github.com/ExaDev/cc-peer/commit/2c9fde0630c8f9621caed42e28397f6c441d7216))

## [1.1.7](https://github.com/ExaDev/cc-peer/compare/v1.1.6...v1.1.7) (2026-09-13)

### Bug Fixes

* **deps:** pin qs to the patched release closing the null-array DoS ([546cea6](https://github.com/ExaDev/cc-peer/commit/546cea6d28c0dabf997cc56d32de35bd2dc386f0))

## [1.1.6](https://github.com/ExaDev/cc-peer/compare/v1.1.5...v1.1.6) (2026-09-13)

### Bug Fixes

* **mutation:** name the vitest-runner plugin explicitly ([2641ed3](https://github.com/ExaDev/cc-peer/commit/2641ed3412363a978f17f844a339c783f52c971d))
* **mutation:** pin vitest to 4.x and pass the config file explicitly to stryker ([d60a28a](https://github.com/ExaDev/cc-peer/commit/d60a28a7508f7583fe8865b835e47a3dc469e5fb))

## [1.1.5](https://github.com/ExaDev/cc-peer/compare/v1.1.4...v1.1.5) (2026-09-12)

## [1.1.4](https://github.com/ExaDev/cc-peer/compare/v1.1.3...v1.1.4) (2026-09-12)

## [1.1.3](https://github.com/ExaDev/cc-peer/compare/v1.1.2...v1.1.3) (2026-09-12)

### Bug Fixes

* **sea:** bundle the entry with inlined deps and follow the documents.js pipeline ([e6dd1df](https://github.com/ExaDev/cc-peer/commit/e6dd1df66551602e5c97ad0e377e2387181c7001))

## [1.1.2](https://github.com/ExaDev/cc-peer/compare/v1.1.1...v1.1.2) (2026-09-12)

### Bug Fixes

* **lint:** ignore the plain-JS SEA build script outside the tsconfig project ([881afce](https://github.com/ExaDev/cc-peer/commit/881afce371698088e6f75a48ce6a016201fbcd78))

## [1.1.1](https://github.com/ExaDev/cc-peer/compare/v1.1.0...v1.1.1) (2026-09-12)

## [1.1.0](https://github.com/ExaDev/cc-peer/compare/v1.0.0...v1.1.0) (2026-09-12)

### Features

* **adapters:** node adapters for transport, registry, keys, and proc info ([36ad018](https://github.com/ExaDev/cc-peer/commit/36ad018c8d3483e14728faf783efc76de46eeb9f))
* **api:** rest facade with zod-derived openapi and the cc-peer bin ([1292cc0](https://github.com/ExaDev/cc-peer/commit/1292cc0801bb33c16183418ae4db73155c9a0cdf))
* **peer:** roster admission, send, inbound handling, and registration ([290c9b3](https://github.com/ExaDev/cc-peer/commit/290c9b340711738593d310affbf5b7e27bd46afe))

## 1.0.0 (2026-09-12)

### Features

* **schemas:** encode the wire protocol as Zod single-source-of-truth ([5c9d93f](https://github.com/ExaDev/cc-peer/commit/5c9d93fba107af8ad225d83a69697107749ad44e))

### Bug Fixes

* **ci:** release as the exadev App to bypass the branch ruleset ([3428669](https://github.com/ExaDev/cc-peer/commit/3428669216532e01fc7db96fa031b3afb2edd44f))
* **release:** publish without the main-branch changelog commit for now ([5ab1ecb](https://github.com/ExaDev/cc-peer/commit/5ab1ecbc2625f59f8352275ff30ab5ef91571183))
* **release:** reference analyzer and generator by package name ([b29bf02](https://github.com/ExaDev/cc-peer/commit/b29bf02c61b79dacb08632e5160774b3150b7c7f))
