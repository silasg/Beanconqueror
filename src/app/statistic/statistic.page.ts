import {Component, OnInit, ViewChild} from '@angular/core';
import {BrewView} from '../../classes/brew/brewView';
import {UIStatistic} from '../../services/uiStatistic';
import {UIHelper} from '../../services/uiHelper';
import {UIBrewStorage} from '../../services/uiBrewStorage';
import {Brew} from '../../classes/brew/brew';
import {IBrew} from '../../interfaces/brew/iBrew';
import {Chart} from 'chart.js';
import {TranslateService} from '@ngx-translate/core';

@Component({
  selector: 'statistic',
  templateUrl: './statistic.page.html',
  styleUrls: ['./statistic.page.scss'],
})
export class StatisticPage implements OnInit {

  @ViewChild('drinkChart', {static: false}) public drinkChart;

  constructor(
    public uiStatistic: UIStatistic,
    private readonly uiBrewStorage: UIBrewStorage,
    private readonly uiHelper: UIHelper,
    private translate: TranslateService
  ) {


  }

  public ionViewDidEnter(): void {
    this.__loadDrinkingChart();
  }

  public ngOnInit() {
  }

  private __sortBrews(_brews: Array<Brew>): Array<IBrew> {
    const sortedBrews: Array<IBrew> = _brews.sort((obj1, obj2) => {
      if (obj1.config.unix_timestamp < obj2.config.unix_timestamp) {
        return -1;
      }
      if (obj1.config.unix_timestamp > obj2.config.unix_timestamp) {
        return 1;
      }

      return 0;
    });
    return sortedBrews;
  }

  private __getBrewsSortedForMonth(): Array<BrewView> {
    const brewViews: Array<BrewView> = [];
    const brews: Array<Brew> = this.uiBrewStorage.getAllEntries();
// sort latest to top.
    const brewsCopy: Array<Brew> = [...brews];

    const sortedBrews: Array<IBrew> = this.__sortBrews(brewsCopy);

    const collection = {};
    // Create collection
    for (const brew of sortedBrews) {
      const month: string = this.uiHelper.formateDate(brew.config.unix_timestamp, 'MMMM');
      const year: string = this.uiHelper.formateDate(brew.config.unix_timestamp, 'YYYY');
      if (collection[month + ' - ' + year] === undefined) {
        collection[month + ' - ' + year] = {
          BREWS: []
        };
      }
      collection[month + ' - ' + year].BREWS.push(brew);
    }

    for (const key in collection) {
      if (collection.hasOwnProperty(key)) {
        const viewObj: BrewView = new BrewView();
        viewObj.title = key;
        viewObj.brews = collection[key].BREWS;

        brewViews.push(viewObj);
      }
    }

    return brewViews;

  }

  private __loadDrinkingChart(): void {
    const brewView: Array<BrewView> = this.__getBrewsSortedForMonth();
    // Take the last 12 Months
    const lastBrewViews: Array<BrewView> = brewView.slice(-12);

    const drinkingData = {
      labels: [],
      datasets: [{
        label: this.translate.instant('PAGE_STATISTICS_DRUNKEN_BREWS'),
        data: []
      }]
    };

    for (const forBrew of lastBrewViews) {
      drinkingData.labels.push(forBrew.title);
    }
    for (const forBrew of lastBrewViews) {
      drinkingData.datasets[0].data.push(forBrew.brews.length);
    }
    const chartOptions = {
      legend: {
        display: true,
        position: 'top'
      }
    };

    this.drinkChart = new Chart(this.drinkChart.nativeElement, {
      type: 'line',
      data: drinkingData,
      options: chartOptions
    });
  }

}
