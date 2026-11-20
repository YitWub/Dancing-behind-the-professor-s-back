import { ProfessorDex } from '@/components/dex/professor/ProfessorDex';
import catalog from '@/data/professors.json';
export default function Page(){
  return <ProfessorDex catalog={catalog.professors} checkedOn={catalog.checkedOn}/>;
}
