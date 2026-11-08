/**
 * An original short story written for testing Lore (names, places, organisations and a late reveal).
 * Also written out as fixtures/lore-saga.txt by scripts/make-fixtures.mjs.
 */
export const SAGA: { title: string; paras: string[] }[] = [
  {
    title: 'Chapter 1: The Harbour',
    paras: [
      'Mira Valen arrived in Port Halloway on the first grey morning of autumn. The harbour smelled of tar and cold salt.',
      'Mira Valen, a cartographer from the inland hills, had come to map the Ashen Sea. Nobody in Port Halloway had asked her to.',
      'Then she met Captain Orsk at the end of the long pier. Orsk was a broad man with a lantern in one hand and a pipe in the other.',
      '“You want a ship,” Orsk said. “Everyone wants a ship. Nobody wants the Ashen Sea.”',
      'Mira smiled. “I want both,” she replied, and Orsk laughed for the first time that week.',
      'Suddenly the bells of the Tidewatch Guild rang across Port Halloway, and every sailor on the pier fell silent.',
    ],
  },
  {
    title: 'Chapter 2: The Guild',
    paras: [
      'The Tidewatch Guild kept a tall grey hall above the harbour. Mira climbed its steps with her maps rolled under one arm.',
      'Doran Kett, the master of the Tidewatch Guild, looked at the maps for a long while without speaking.',
      '“These are good,” Doran Kett said at last. “Too good. The Ashen Sea does not like to be drawn.”',
      'Mira asked what he meant, but Doran only shook his head and called for Orsk.',
      'Orsk came in smelling of rain. He and Doran argued in low voices while Mira studied the old charts on the wall.',
      'One chart showed an island she had never heard of: Greywater Isle, far out in the Ashen Sea.',
    ],
  },
  {
    title: 'Chapter 3: Greywater',
    paras: [
      'They sailed for Greywater Isle at dawn. Orsk steered, Mira drew, and the Ashen Sea stayed calm.',
      'On the third day a black ship crossed their wake. Orsk said it belonged to the Hollow Crown, and that they should pray it kept going.',
      'The Hollow Crown, a band of raiders who answered to no harbour, had burned two Guild ships that spring.',
      'Mira added the black ship to her map anyway. Orsk grumbled that she would draw her own grave if she could.',
      'At night Mira wrote to Doran Kett, though there was nowhere to post the letter.',
      'Greywater Isle rose out of the fog on the fifth morning, grey and silent and wrong.',
    ],
  },
  {
    title: 'Chapter 4: The Lighthouse',
    paras: [
      'A lighthouse stood on Greywater Isle with no keeper and a lamp that still burned.',
      'Mira climbed the lighthouse while Orsk waited below with the boat. Inside, every wall was covered in maps of the Ashen Sea.',
      'Every map was signed with the same name: Seraphine.',
      'Mira copied the signature carefully. Orsk did not like the name, and said so twice.',
      'When they rowed back to the ship, the lamp in the lighthouse went out.',
      'Mira looked back at Greywater Isle and could have sworn someone was watching from the top of the tower.',
    ],
  },
  {
    title: 'Chapter 5: Seraphine',
    paras: [
      'Seraphine Vale, the first cartographer of the Ashen Sea, had vanished forty years before Mira was born.',
      'Doran Kett told them this when they returned to Port Halloway, his voice very quiet.',
      '“Seraphine Vale drew the sea and the sea drew her back,” Doran said. “That is what the Tidewatch Guild believes.”',
      'Mira asked whether Seraphine Vale had any family. Doran Kett looked at her for a long time.',
      '“She had a daughter,” he said. “The daughter was raised in the inland hills by a cartographer named Valen.”',
      'Mira Valen put down her maps and did not speak again that night.',
    ],
  },
  {
    title: 'Chapter 6: The Crown',
    paras: [
      'The Hollow Crown came to Port Halloway on the night of the first frost.',
      'Orsk woke Mira with a lantern and said they had to leave before the Hollow Crown reached the harbour.',
      'Doran Kett stayed behind to hold the Tidewatch Guild hall. Mira saw the fire from the water.',
      'They sailed for Greywater Isle again, because there was nowhere else to go.',
      'The lamp in the lighthouse was burning when they arrived.',
      'Seraphine Vale was waiting at the top of the stairs.',
    ],
  },
];

export const sagaHtml = (i: number) => SAGA[i].paras.map((p) => `<p>${p}</p>`).join('');
