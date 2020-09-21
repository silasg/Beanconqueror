/** Interfaces */
import {BEAN_MIX_ENUM} from '../../enums/beans/mix';
/** Enums */
import {ROASTS_ENUM} from '../../enums/beans/roasts';
import {IBean} from '../../interfaces/bean/iBean';
/** Classes */
import {Config} from '../objectConfig/objectConfig';
import moment from 'moment';

export class Bean implements IBean {
  public name: string;
  public roastingDate: string;
  public note: string;
  /** @deprecated use attachments instead */
  public filePath: string;
  public roaster: string;
  public config: Config;
  public roast: ROASTS_ENUM;
  public roast_range: number;
  public beanMix: BEAN_MIX_ENUM;
  public variety: string;
  public processing: string;
  public country: string;
  // tslint:disable-next-line
  public roast_custom: string;
  public aromatics: string;
  public weight: number;
  public finished: boolean;
  public cost: number;
  public attachments: Array<string>;


  constructor() {
    this.name = '';
    this.roastingDate = '';
    this.note = '';
    this.filePath = '';
    this.roaster = '';
    this.config = new Config();
    this.roast = 'UNKNOWN' as ROASTS_ENUM;
    this.roast_range = 0;
    this.roast_custom = '';
    this.beanMix = 'SINGLE_ORIGIN' as BEAN_MIX_ENUM;
    this.variety = '';
    this.processing = '';
    this.country = '';
    this.aromatics = '';
    this.weight = 0;
    this.finished = false;
    this.cost = 0;
    this.attachments = [];
  }

  public getRoastName(): string {
    return ROASTS_ENUM[this.roast];
  }

  public initializeByObject(beanObj: IBean): void {
    Object.assign(this, beanObj);
  }

  public fixDataTypes(): boolean {
    let fixNeeded: boolean = false;


    if (Number(this.cost) !== this.cost) {
      this.cost = Number(this.cost);
      fixNeeded = true;
    }


    if (Number(this.weight) !== this.weight) {
      this.weight = Number(this.weight);
      fixNeeded = true;
    }


    return fixNeeded;
  }
  public beanAgeInDays(): number {
    const today = Date.now();
    let millisecondsSinceRoasting = today - Date.parse(this.roastingDate);
    if (isNaN(millisecondsSinceRoasting)) {
      millisecondsSinceRoasting = 0;
    }
    return Math.floor(millisecondsSinceRoasting / (1000 * 60 * 60 * 24));
  }

  /**
   * Get the calculated bean age for this brew
   */
  public getCalculatedBeanAge(): number {

    const roastingDate = moment(this.roastingDate);
    const brewTime = moment.unix(moment().unix());

    return brewTime.diff(roastingDate, 'days');
  }


}
