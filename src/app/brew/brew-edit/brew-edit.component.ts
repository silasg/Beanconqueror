import {Component, OnInit, ViewChild} from '@angular/core';
import {UIBeanStorage} from '../../../services/uiBeanStorage';
import {BREW_QUANTITY_TYPES_ENUM} from '../../../enums/brews/brewQuantityTypes';
import {UIHelper} from '../../../services/uiHelper';
import {UIBrewStorage} from '../../../services/uiBrewStorage';
import {IBrew} from '../../../interfaces/brew/iBrew';
import {IonSlides, ModalController, NavParams} from '@ionic/angular';
import {UIMillStorage} from '../../../services/uiMillStorage';
import {UIPreparationStorage} from '../../../services/uiPreparationStorage';
import {UIImage} from '../../../services/uiImage';
import {Brew} from '../../../classes/brew/brew';
import moment from 'moment';
import {UIAnalytics} from '../../../services/uiAnalytics';
import {ISettings} from '../../../interfaces/settings/iSettings';
import {UISettingsStorage} from '../../../services/uiSettingsStorage';
import {Preparation} from '../../../classes/preparation/preparation';
import {Mill} from '../../../classes/mill/mill';
import {Bean} from '../../../classes/bean/bean';
import {UIToast} from '../../../services/uiToast';
import {UIFileHelper} from '../../../services/uiFileHelper';

@Component({
  selector: 'brew-edit',
  templateUrl: './brew-edit.component.html',
  styleUrls: ['./brew-edit.component.scss'],
})
export class BrewEditComponent implements OnInit {


  @ViewChild('photoSlides', {static: false}) public photoSlides: IonSlides;
  public data: Brew = new Brew();

  public brewQuantityTypeEnums = BREW_QUANTITY_TYPES_ENUM;
  public method_of_preparations: Array<Preparation> = [];
  public beans: Array<Bean> = [];
  public mills: Array<Mill> = [];
  public settings: ISettings;
  public customCreationDate: string = '';

  public customSelectSheetOptions: any = {
    cssClass: 'select-full-screen'
  };

  constructor (private readonly modalController: ModalController,
               private readonly navParams: NavParams,
               private readonly uiBeanStorage: UIBeanStorage,
               private readonly uiPreparationStorage: UIPreparationStorage,
               private readonly uiBrewStorage: UIBrewStorage,
               public uiHelper: UIHelper,
               private readonly uiImage: UIImage,
               private readonly uiMillStorage: UIMillStorage,
               private readonly uiAnalytics: UIAnalytics,
               private readonly uiSettingsStorage: UISettingsStorage,
               private readonly uiToast: UIToast,
               private readonly uiFileHelper: UIFileHelper) {

    this.settings = this.uiSettingsStorage.getSettings();
    // Moved from ionViewDidEnter, because of Ionic issues with ion-range
    const brew: IBrew = this.uiHelper.copyData(this.navParams.get('brew'));

    if (brew !== undefined) {
      this.data.initializeByObject(brew);
    }

    this.method_of_preparations = this.uiPreparationStorage.getAllEntries()
        .sort((a, b) => a.name.localeCompare(b.name));
    this.beans = this.uiBeanStorage.getAllEntries()
        .sort((a, b) => a.name.localeCompare(b.name));
    this.mills = this.uiMillStorage.getAllEntries()
        .sort((a, b) => a.name.localeCompare(b.name));
  }

  public ionViewDidEnter(): void {
    this.uiAnalytics.trackEvent('BREW', 'EDIT');

    this.customCreationDate = moment.unix(this.data.config.unix_timestamp).toISOString();
  }

  public showRating(): boolean {
    if (this.data !== undefined) {
      return true;
    }
    return false;
  }

  public addImage(): void {
    this.uiImage.showOptionChooser()
        .then((_option) => {
          if (_option === 'CHOOSE') {
            // CHOSE
            this.uiImage.choosePhoto()
                .then((_path) => {
                  if (_path) {
                    this.data.attachments.push(_path.toString());
                  }

                });
          } else {
            // TAKE
            this.uiImage.takePhoto()
                .then((_path) => {
                  this.data.attachments.push(_path.toString());
                });
          }
        });
  }

  public async deleteImage(_index: number) {
    const splicedPaths: Array<string> = this.data.attachments.splice(_index, 1);
    for (const path of splicedPaths) {
      try {
        await this.uiFileHelper.deleteFile(path);
        this.uiToast.showInfoToast('IMAGE_DELETED');
      } catch (ex) {
        this.uiToast.showInfoToast('IMAGE_NOT_DELETED');
      }

    }
    if (this.data.attachments.length > 0) {
      // Slide to one item before
      this.photoSlides.slideTo(_index - 1, 0);
    }
  }

  public dismiss(): void {
    this.modalController.dismiss({
      'dismissed': true
    });
  }

  public updateBrew(): void {
    const newUnix = moment(this.customCreationDate).unix();
    if (newUnix !== this.data.config.unix_timestamp) {
      this.data.config.unix_timestamp = newUnix;
    }

    this.uiBrewStorage.update(this.data);
    this.uiToast.showInfoToast('TOAST_BREW_EDITED_SUCCESSFULLY');
    this.dismiss();
  }

  public ngOnInit() {}


}
