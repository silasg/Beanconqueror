import { inject, Injectable } from '@angular/core';

import type { Bean } from '../../classes/bean/bean';
import {
  buildCloudExtractionPrompt,
  CLOUD_BEAN_IMPORT_SYSTEM_INSTRUCTIONS,
} from '../../data/ai-import/ai-cloud-prompt';
import { BEAN_ROASTING_TYPE_ENUM } from '../../enums/beans/beanRoastingType';
import { BEAN_MIX_ENUM } from '../../enums/beans/mix';
import { IBeanInformation } from '../../interfaces/bean/iBeanInformation';
import { UILog } from '../uiLog';
import { UISettingsStorage } from '../uiSettingsStorage';
import {
  constructBeanFromExtractedData,
  createDefaultBean,
  createEmptyBeanInformation,
} from './bean-construction.service';
import {
  OriginFieldsResult,
  TopLevelFieldsResult,
} from './bean-extraction-types';
import {
  CloudLLMConfig,
  sendCloudLLMPrompt,
} from './cloud-llm-communication.service';
import {
  extractJsonFromResponse,
  isNullLikeValue,
} from './llm-communication.service';

/**
 * Service for extracting all bean fields in a single cloud LLM call.
 *
 * Orchestrates the full cloud extraction pipeline:
 * 1. Build config from caller-supplied settings
 * 2. Build the unified extraction prompt
 * 3. Send to cloud LLM provider
 * 4. Parse JSON response
 * 5. Map response to shared types and construct a Bean
 */
@Injectable({ providedIn: 'root' })
export class CloudFieldExtractionService {
  private uiSettingsStorage = inject(UISettingsStorage, { optional: true });
  private uiLog = inject(UILog, { optional: true });

  /**
   * Extract all bean fields from OCR text using a cloud LLM.
   *
   * Returns a fallback empty Bean on any failure so the user can
   * still manually fill in fields rather than losing their captured photos.
   *
   * @param ocrText Layout-enriched OCR text from the label
   * @param config  Optional cloud LLM config; defaults to current settings
   * @param logger  Optional logger; defaults to injected UILog
   */
  public async extractAllFields(
    ocrText: string,
    config?: CloudLLMConfig,
    logger?: { log(msg: string): void },
  ): Promise<Bean> {
    const log = logger ?? this.uiLog ?? { log: () => {} };
    try {
      // 1. Build config from settings if not provided
      if (!config) {
        const settings = this.uiSettingsStorage!.getSettings();
        config = {
          provider: settings.cloud_ai_provider,
          apiKey: settings.cloud_ai_api_key,
          model: settings.cloud_ai_model,
          baseUrl: settings.cloud_ai_base_url || undefined,
        };
      }

      // 2. Build prompt
      const userPrompt = buildCloudExtractionPrompt(ocrText);

      // 3. Send to cloud LLM
      const response = await sendCloudLLMPrompt(config, [
        { role: 'system', content: CLOUD_BEAN_IMPORT_SYSTEM_INSTRUCTIONS },
        { role: 'user', content: userPrompt },
      ]);

      log.log('Cloud LLM response received, model: ' + response.model);
      if (response.usage) {
        log.log(
          `Token usage: ${response.usage.prompt_tokens} prompt, ${response.usage.completion_tokens} completion`,
        );
      }

      // 4. Parse JSON from response (handle potential markdown wrapping)
      const parsed = extractJsonFromResponse(response.content);
      if (!parsed) {
        log.log('Failed to parse JSON from cloud LLM response');
        return createDefaultBean();
      }

      // 5. Map to TopLevelFieldsResult + OriginFieldsResult
      const topLevel = this.mapTopLevelFields(parsed);
      const origin = this.mapOriginFields(parsed);

      // 6. Construct bean using shared utility
      return constructBeanFromExtractedData(topLevel, origin);
    } catch (error) {
      log.log('Cloud field extraction failed: ' + error?.message);
      return createDefaultBean();
    }
  }

  /**
   * Map the parsed JSON response to TopLevelFieldsResult.
   * Uses isNullLikeValue to strip NOT_FOUND/null/unknown responses.
   */
  private mapTopLevelFields(parsed: any): TopLevelFieldsResult {
    const result: TopLevelFieldsResult = {
      name: '',
      roaster: '',
      weight: 0,
    };

    // Name
    if (!isNullLikeValue(parsed.name)) {
      result.name = String(parsed.name).trim();
    }

    // Roaster
    if (!isNullLikeValue(parsed.roaster)) {
      result.roaster = String(parsed.roaster).trim();
    }

    // Weight — JSON returns "250g", "1kg", "12oz" etc.; parse to grams
    if (parsed.weight !== null) {
      if (typeof parsed.weight === 'number') {
        result.weight = parsed.weight;
      } else if (!isNullLikeValue(String(parsed.weight))) {
        result.weight = this.parseWeight(String(parsed.weight));
      }
    }

    // Bean roasting type — map "FILTER"/"ESPRESSO"/"OMNI" to enum
    if (!isNullLikeValue(parsed.bean_roasting_type)) {
      result.bean_roasting_type = this.mapRoastingType(
        String(parsed.bean_roasting_type).trim(),
      );
    }

    // Aromatics
    if (!isNullLikeValue(parsed.aromatics)) {
      result.aromatics = String(parsed.aromatics).trim();
    }

    // Decaffeinated — JSON returns boolean true/false
    if (parsed.decaffeinated === true || parsed.decaffeinated === false) {
      result.decaffeinated = parsed.decaffeinated;
    } else if (
      parsed.decaffeinated !== null &&
      !isNullLikeValue(String(parsed.decaffeinated))
    ) {
      result.decaffeinated =
        String(parsed.decaffeinated).toLowerCase() === 'true';
    }

    // Cupping points — JSON returns a number
    if (parsed.cupping_points !== null) {
      if (typeof parsed.cupping_points === 'number') {
        result.cupping_points = parsed.cupping_points;
      } else if (!isNullLikeValue(String(parsed.cupping_points))) {
        const points = parseFloat(String(parsed.cupping_points));
        if (!isNaN(points)) {
          result.cupping_points = points;
        }
      }
    }

    // Roasting date — JSON returns "YYYY-MM-DD"
    if (!isNullLikeValue(parsed.roasting_date)) {
      result.roastingDate = String(parsed.roasting_date).trim();
    }

    return result;
  }

  /**
   * Map the parsed JSON response to OriginFieldsResult.
   * Maps bean_mix and origins array to the shared types.
   */
  private mapOriginFields(parsed: any): OriginFieldsResult {
    const result: OriginFieldsResult = {
      beanMix: BEAN_MIX_ENUM.UNKNOWN,
      bean_information: [],
    };

    // Bean mix — map "SINGLE_ORIGIN"/"BLEND" to enum
    if (!isNullLikeValue(parsed.bean_mix)) {
      result.beanMix = this.mapBeanMix(String(parsed.bean_mix).trim());
    }

    // Origins — each entry maps to an IBeanInformation
    if (Array.isArray(parsed.origins)) {
      result.bean_information = parsed.origins.map((origin: any) =>
        this.mapOrigin(origin),
      );
    }

    return result;
  }

  /**
   * Map a single origin object from JSON to IBeanInformation.
   */
  private mapOrigin(origin: any): IBeanInformation {
    const info = createEmptyBeanInformation();

    if (!isNullLikeValue(origin.country)) {
      info.country = String(origin.country).trim();
    }
    if (!isNullLikeValue(origin.region)) {
      info.region = String(origin.region).trim();
    }
    if (!isNullLikeValue(origin.variety)) {
      info.variety = String(origin.variety).trim();
    }
    if (!isNullLikeValue(origin.processing)) {
      info.processing = String(origin.processing).trim();
    }
    if (!isNullLikeValue(origin.elevation)) {
      info.elevation = String(origin.elevation).trim();
    }
    if (!isNullLikeValue(origin.farm)) {
      info.farm = String(origin.farm).trim();
    }
    if (!isNullLikeValue(origin.farmer)) {
      info.farmer = String(origin.farmer).trim();
    }

    // Percentage — handle numeric or string "60%"
    if (origin.percentage !== null) {
      if (typeof origin.percentage === 'number') {
        info.percentage = origin.percentage;
      } else if (!isNullLikeValue(String(origin.percentage))) {
        const pct = parseFloat(String(origin.percentage).replace('%', ''));
        if (!isNaN(pct)) {
          info.percentage = pct;
        }
      }
    }

    return info;
  }

  /**
   * Map roasting type string from JSON to BEAN_ROASTING_TYPE_ENUM.
   */
  private mapRoastingType(value: string): BEAN_ROASTING_TYPE_ENUM {
    switch (value.toUpperCase()) {
      case 'FILTER':
        return BEAN_ROASTING_TYPE_ENUM.FILTER;
      case 'ESPRESSO':
        return BEAN_ROASTING_TYPE_ENUM.ESPRESSO;
      case 'OMNI':
        return BEAN_ROASTING_TYPE_ENUM.OMNI;
      default:
        return BEAN_ROASTING_TYPE_ENUM.UNKNOWN;
    }
  }

  /**
   * Map bean mix string from JSON to BEAN_MIX_ENUM.
   */
  private mapBeanMix(value: string): BEAN_MIX_ENUM {
    switch (value.toUpperCase()) {
      case 'SINGLE_ORIGIN':
        return BEAN_MIX_ENUM.SINGLE_ORIGIN;
      case 'BLEND':
        return BEAN_MIX_ENUM.BLEND;
      default:
        return BEAN_MIX_ENUM.UNKNOWN;
    }
  }

  /**
   * Parse a weight string (e.g. "250g", "1kg", "12oz") to grams.
   * Mirrors the conversion logic in TextNormalizationService.extractWeight.
   */
  private parseWeight(weightStr: string): number {
    const str = weightStr.toLowerCase().trim();

    const kgMatch = /(\d+(?:[.,]\d+)?)\s*(?:kg|kilo(?:gram)?s?)/.exec(str);
    if (kgMatch) {
      return Math.round(parseFloat(kgMatch[1].replace(',', '.')) * 1000);
    }

    const ozMatch = /(\d+(?:[.,]\d+)?)\s*(?:oz|ounces?)/.exec(str);
    if (ozMatch) {
      return Math.round(parseFloat(ozMatch[1].replace(',', '.')) * 28.3495);
    }

    const lbMatch = /(\d+(?:[.,]\d+)?)\s*(?:lb|lbs?|pounds?)/.exec(str);
    if (lbMatch) {
      return Math.round(parseFloat(lbMatch[1].replace(',', '.')) * 453.592);
    }

    const gMatch = /(\d+(?:[.,]\d+)?)\s*(?:g(?:rams?)?)?/.exec(str);
    if (gMatch) {
      return Math.round(parseFloat(gMatch[1].replace(',', '.')));
    }

    return 0;
  }
}
