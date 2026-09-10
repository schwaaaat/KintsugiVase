import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {md5Hex} from '../src/ui/md5';

describe('Orca G-code checksum',()=>{
  for(const text of ['', 'abc', 'G1 X10 Y20 E0.42\n; π vase\n', 'x'.repeat(1_000_003)]){
    it(`matches Node MD5 for ${text.length} UTF-8 characters`,()=>{
      expect(md5Hex(text)).toBe(createHash('md5').update(text,'utf8').digest('hex').toUpperCase());
    });
  }
});
