import { describe, expect, it } from 'vitest';
import { applyStateOperations, blankState, normalizeState, stateColumns, singletons } from './state.js';
import type { StateTableName } from './index.js';

const inserts:Record<string,Record<string,string>>={important_characters:{name:'Sina',gender_age:'adult',is_absent:'否'},protagonist_skills:{skill_name:'Light',skill_type:'magic'},inventory:{item_name:'Letter',quantity:'1',category:'document'},quests_events:{quest_name:'Find the sender',quest_type:'story'}};
const tables=Object.keys(stateColumns) as StateTableName[];
const seeded=()=>{let state=blankState();for(const [table,cells]of Object.entries(inserts))state=applyStateOperations(state,[{table,op:'insertRow',cells}]).tables;return state;};
describe('six-table atomic state',()=>{
  it('bootstraps two singletons and four empty collections',()=>{const state=blankState();expect(Object.keys(state)).toHaveLength(6);for(const table of tables)expect(state[table].length).toBe(singletons.has(table)?1:0);});
  it('drops retired options on import but rejects new option operations', () => {
    const state = normalizeState({ global_state: [{ row_id: 1, current_location: 'Tower' }], options: [{ row_id: 1, option_1: 'old action' }] });
    expect(state).not.toHaveProperty('options');
    expect(state.global_state[0]?.current_location).toBe('Tower');
    expect(() => applyStateOperations(state, [{ op: 'updateRow', table: 'options', rowId: 1, cells: { option_1: 'new action' } }])).toThrow();
  });
  it.each(tables)('rejects unknown columns atomically in %s',(table)=>{const state=seeded();const before=structuredClone(state);expect(()=>applyStateOperations(state,[{table,op:'updateRow',rowId:1,cells:{unknown:'bad'}}])).toThrow();expect(state).toEqual(before);});
  it.each(tables)('rejects model-assigned row IDs in %s',(table)=>{expect(()=>applyStateOperations(seeded(),[{table,op:'updateRow',rowId:1,cells:{row_id:2}}])).toThrow();});
  it.each(tables)('rejects missing update row in %s',(table)=>{expect(()=>applyStateOperations(seeded(),[{table,op:'updateRow',rowId:999,cells:{}}])).toThrow();});
  it.each(tables)('rejects structured cell values in %s',(table)=>{expect(()=>applyStateOperations(seeded(),[{table,op:'updateRow',rowId:1,cells:{[stateColumns[table][0]!]:{nested:true}}}])).toThrow();});
  it.each(tables)('same-value update does not checkpoint %s',(table)=>{const state=seeded();const column=stateColumns[table][0]!;expect(applyStateOperations(state,[{table,op:'updateRow',rowId:1,cells:{[column]:state[table][0]![column]}}]).changed).toBe(false);});
  it.each(tables.flatMap((table)=>stateColumns[table].map((column)=>({table,column}))))('accepts an evidenced scalar update $table.$column',({table,column})=>{const state=seeded();const value=column==='quantity'?'2':column==='is_absent'?'是':'updated';const result=applyStateOperations(state,[{table,op:'updateRow',rowId:1,cells:{[column]:value}}]);expect(result.changed).toBe(true);expect(result.tables[table][0]![column]).toBe(value);});
  it.each([...singletons])('singleton %s forbids inserts and deletes',(table)=>{for(const op of ['insertRow','deleteRow'])expect(()=>applyStateOperations(blankState(),[{table,op,rowId:1,cells:{}}])).toThrow();});
  it.each(Object.keys(inserts))('preserves identity uniqueness in %s',(table)=>{const state=seeded();const cells=inserts[table]!;const key=Object.keys(cells)[0]!;expect(()=>applyStateOperations(state,[{table,op:'insertRow',cells:{...cells,[key]:` ${cells[key]!.toUpperCase()} `}}])).toThrow(/Duplicate/);});
  it.each(['0','-1','1.5','abc','','Infinity'])('rejects invalid quantity %s',(quantity)=>{expect(()=>applyStateOperations(seeded(),[{table:'inventory',op:'updateRow',rowId:1,cells:{quantity}}])).toThrow();});
  it.each(['yes','no','true','',1,null])('rejects invalid is_absent %s',(is_absent)=>{expect(()=>applyStateOperations(seeded(),[{table:'important_characters',op:'updateRow',rowId:1,cells:{is_absent}}])).toThrow();});
  it('does not mutate the original if a later operation fails',()=>{const original=seeded();const before=structuredClone(original);expect(()=>applyStateOperations(original,[{table:'global_state',op:'updateRow',rowId:1,cells:{current_location:'changed'}},{table:'inventory',op:'updateRow',rowId:1,cells:{quantity:'0'}}])).toThrow();expect(original).toEqual(before);});
  it('retains model operation order',()=>{const result=applyStateOperations(blankState(),[{table:'inventory',op:'insertRow',cells:inserts.inventory},{table:'inventory',op:'updateRow',rowId:1,cells:{quantity:'3'}}]);expect(result.tables.inventory[0]?.quantity).toBe('3');});
  it('allows deleting ordinary collection rows',()=>{for(const table of ['inventory','quests_events','protagonist_skills'])expect(applyStateOperations(seeded(),[{table,op:'deleteRow',rowId:1}]).tables[table as StateTableName]).toEqual([]);});
  it('preserves valid IDs while repairing missing and duplicate IDs',()=>{const state=normalizeState({inventory:[{item_name:'a'},{row_id:1,item_name:'b'},{row_id:1,item_name:'c'}]});expect(state.inventory[1]?.row_id).toBe(1);expect(new Set(state.inventory.map((r)=>r.row_id)).size).toBe(3);});
  it('repairs partial snapshots without modifying existing values',()=>{const state=normalizeState({global_state:[{row_id:1,current_location:'Tower'}]});expect(state.global_state[0]?.current_location).toBe('Tower');expect(state.protagonist_info).toHaveLength(1);});
  it('rejects unknown tables in persisted data',()=>{expect(()=>normalizeState({sql_table:[]})).toThrow();});
  it('keeps long conclusion text without truncation',()=>{const text='长'.repeat(1500);const result=applyStateOperations(blankState(),[{table:'protagonist_info',op:'updateRow',rowId:1,cells:{past_experience:text}}]);expect(result.tables.protagonist_info[0]?.past_experience).toBe(text);});
  it('allows unrelated updates when a legacy duplicate already exists',()=>{const state=seeded();state.inventory.push({...state.inventory[0]!,row_id:2});expect(applyStateOperations(state,[{table:'inventory',op:'updateRow',rowId:1,cells:{description:'old duplicate'}}]).changed).toBe(true);});
});
