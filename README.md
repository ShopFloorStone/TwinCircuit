# TwinCircuit · X Layer TapeOut Accelerate

TwinCircuit helps electronics manufacturers and independent test teams hand off unfinished work across factories while keeping one acceptance specification and one review trail. Capacity bookings, completed batches and the rule version stay attached to the order.

[Live application](https://twincircuit.online/) · [83-second video with English subtitles](https://twincircuit.online/demo/en/) · [English guide](https://twincircuit.online/guide/en/) · [中文指南](https://twincircuit.online/guide/)

## Review the workflow

1. Open the live application and select the standalone demo workspace. The demo starts with order TC-024, which distributes 100 digital I/O tests between two virtual factories.
2. Factory A completes 40 of its assigned 60 before a simulated interruption. Transfer its 20 unstarted tests to factory B. The order keeps its original acceptance rule and completed records.
3. Review the test batches and export the audit trail. The virtual exercise generates 800 vector results. The separate physical test bench recorded eight matching ESP32-S3 display-controller memory readbacks.

## Reproduce the TapeOut integration

The application compiles digital acceptance rules to TapeOut-compatible NAND netlists. It reads a registered TapeOut processor on X Layer mainnet and compares each circuit output with local replay. TC-IC/0.1 defines a first-article readiness rule, two measurement dispositions and a process-license eligibility rule.

From the repository root, use Node.js 24 or newer.

```sh
node review.mjs
node review.mjs --xlayer
```

The first command checks the published artifact digest and replays all 96 vectors across four profiles offline. The second command also reads the existing public reference circuit and checks all four two-input NAND combinations at one block. The X Layer network ID is 196 and the reference Circuit ID is 2. The commands only read data.

[TC-IC/0.1 public draft](https://twincircuit.online/standard/en/) · [TapeOut integration guide](https://twincircuit.online/guide/en/developer-and-chain/) · [Reference processor on X Layer](https://web3.okx.com/explorer/x-layer/address/0x839bdd6fa7a66416a609a735e11de5411b98574e)

## What we built during the event

- **November 19, 2026** Public prototype, bilingual workflow demo and TC-IC/0.1 draft with reproducible vectors.
- **November 26, 2026** Reusable factory specification templates, concurrent order-handling improvements and deployment of the BEM escrow contract to X Layer mainnet.

The simulation, physical bench, existing TapeOut circuit and escrow deployment are distinct evidence. Physical acceptance requires an independent review. The project’s TFT and TC-IC application netlists are available for local replay, with their mainnet publication still pending in the project records. The public prototype report records zero customer PLC deployments and zero live mainnet payments.

[Prototype evidence](https://twincircuit.online/whitepaper/en/#chapter-10) · [Escrow deployment transaction](https://web3.okx.com/explorer/x-layer/tx/0xf99600fd97644380a4c5ed18acf6a882144e199f2302f42b0c769eca1a3f929f)

## 中文简介

TwinCircuit 让多家工厂按同一版规格承接、转交和验收检测工单。评委可先体验 100 次检测转单演示，再运行上面的命令复算 96 组公开向量，并在 X Layer 核对既有 TapeOut NAND 参考电路的 4 组输出。
