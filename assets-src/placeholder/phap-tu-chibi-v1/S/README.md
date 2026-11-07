# S full-source compatibility motion

15 smooth-v2 clips /202 frames, natural left-hand fan. D41 export only; extracted body/weapon/FX sets follow in the dedicated class extraction pass after all5 directions merge.

Official D45 guides are reproduced from committed sources with:

```sh
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-chibi-v1/S/project.json --out <fresh-temp-directory>
```

Input project SHA256: `c9c0e3f79a5334687bd9b3f3bcf467ff87601f280db711200e293a59cd7ed7e1`. Master SHA256: `1c2b8e63d96016f8a000683fb017b0c38dd937d497c4ed6daf6514bb180f3168`. Generated layer-inputs.json SHA256: `64d9489f012ec5d4eeffe1268a91e14cc45b08f65711c6c7105329e7999bb92c`. The manifest pins every source sheet and clip mapping. Derived PNGs remain temporary until extraction.

| Guide              | SHA256                                                           |
| ------------------ | ---------------------------------------------------------------- |
| source-0.full.png  | e281b1a323f1e12a7342b5092db9cb0e3595032196968429557fc48e86343d69 |
| source-1.full.png  | d6ffc274d413e07214b6176fd5dcd707f53c2cece9f82408b14da2308f1025bf |
| source-2.full.png  | 1c97555ffcd7ffd69bd72192e69ef65291057ef10ddf06e502d5f9e6198325b5 |
| source-3.full.png  | 8c0c51eea0c38fb30e56dfbc90a984d4b707e7dcab5d9f46c55262d54d1a7fbf |
| source-4.full.png  | 3731c0525735a889ecc6d99a7a09e2c93b94522261c75c12a1460d5c81544eeb |
| source-5.full.png  | 23d225cb1c336bba92ea0e23a701fbf9bb0dec3448c001a3473ed86fd8c6ee4e |
| source-6.full.png  | 7f531241dfc23a30d99f8fd8e142b989f35ae677baafdfb5ae2d8a1a7c3f452b |
| source-7.full.png  | be29f484082874951d0d14d4a34cbfee0d78d13f6372407c28cf229d62596d6f |
| source-8.full.png  | a07350c9db0408437636f671efe5f6bc42ce83f3bb7cb833e215c234d91b03d1 |
| source-9.full.png  | 53d7b39d18c0df43564b94091a91c13d6b5e7f4fdd37fa84430fb008ac48f1e1 |
| source-10.full.png | 34abb5bfcf3f03892166b7eddbc4d367beb18c70f14e9deee4004f1196070364 |
| source-11.full.png | e3a3b750a0b938e2ff639e0f8df91a78e34de1f9d2551e640fc7a123e7ab63d7 |
| source-12.full.png | 7efddbb5d941b0a7e3561a7e8747e93ce377c58da3665a0be80b1df12e66be8a |
| source-13.full.png | 24e6d3de6f23b3cacd7201d2f21750df2d2d9e84984d585b8fa7583e59eeab06 |

S/selection.json preserves the reviewed attempt choices. Head evidence and open foot findings are in the review/backlog records. engine-gate.json records real Cocos3.8.8 2� capture of all15 clips against matching runtime source bytes.
